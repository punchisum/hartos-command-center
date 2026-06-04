/**
 * src/runtime/cloudflare-cockpit-worker.ts
 *
 * Cloudflare-compatible read-only cockpit Worker. This is a THIN adapter:
 *
 *   Cloudflare Request → adapter → existing cockpit render/validate logic → safe Response
 *
 * It reuses the local cockpit's render output (via a pre-built snapshot context),
 * the local request validation (cockpit-state), and the deterministic LLM path
 * (llm/providers/deterministic-provider). It NEVER reads the filesystem at
 * request time, NEVER mutates anything, NEVER executes an action, and NEVER
 * exposes env values. The local cockpit (cockpit-server.ts) is unchanged.
 *
 * Routes:
 *   GET  /                          → cockpit HTML (from the snapshot)
 *   GET  /health                    → { ok }
 *   GET  /api/state                 → cockpit state JSON (read-only)
 *   GET  /api/reports               → report list JSON (read-only)
 *   GET  /api/threads               → thread list JSON (read-only)
 *   GET  /api/debug/status          → safe, redacted metadata (presence only)
 *   POST /api/orchestrator/message  → validated, deterministic classification
 */

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { CloudflareCockpitEnv, CockpitWorkerContext } from "./cloudflare-cockpit-types.js";
import {
  jsonResponse,
  htmlResponse,
  safeError,
  notFound,
  methodNotAllowed,
  payloadTooLarge,
} from "./cloudflare-response.js";
import {
  ALLOWED_METHODS,
  ACTION_EXECUTION,
  MUTATION_ENDPOINTS,
  MAX_REQUEST_BODY_BYTES,
  corsHeaders,
} from "./cloudflare-security.js";
import { summarizeEnvPresence, resolveLlmNetworkGate } from "./cloudflare-env.js";
import { validateRequest } from "../cockpit/cockpit-state.js";
import { deterministicOutput } from "../llm/providers/deterministic-provider.js";
import { buildCockpitState } from "../cockpit/cockpit-read-model.js";
import {
  authenticateCockpitRequest,
  attemptLogin,
  type AuthResult,
} from "./cloudflare-cockpit-auth.js";
import {
  renderHostedCockpitPage,
  renderLoginPage,
  renderLockedPage,
} from "./cloudflare-cockpit-page.js";
import { routeHosted, freshnessView, readModelStatusView, proposalsView } from "./cloudflare-cockpit-views.js";

export const SUPPORTED_ROUTES = [
  "GET /",
  "GET /health",
  "GET /api/state",
  "GET /api/reports",
  "GET /api/threads",
  "GET /api/freshness",
  "GET /api/read-models/status",
  "GET /api/proposals",
  "GET /api/debug/status",
  "POST /api/login",
  "POST /api/ask",
  "POST /api/orchestrator/message",
] as const;

/**
 * Handle one hosted-cockpit request against a pre-built snapshot context.
 * Pure with respect to the request — tests call this directly with a mocked
 * Request + Env. No filesystem access happens here.
 */
export async function handleCockpitRequest(
  request: Request,
  env: CloudflareCockpitEnv,
  ctx: CockpitWorkerContext = {}
): Promise<Response> {
  const method = request.method.toUpperCase();
  const origin = request.headers.get("origin");
  const cors = corsHeaders(env, origin);

  if (!(ALLOWED_METHODS as readonly string[]).includes(method)) {
    return methodNotAllowed(cors);
  }

  const url = new URL(request.url);
  const pathname = url.pathname;

  // CORS preflight — default-denied unless an allowed origin is configured.
  if (method === "OPTIONS") {
    return new Response(null, { status: Object.keys(cors).length > 0 ? 204 : 403, headers: cors });
  }

  // ── Public routes (no auth) ──────────────────────────────────────────────
  // /health is a safe uptime check (no secrets). /api/login is the auth entry.
  if (method === "GET" && pathname === "/health") {
    return jsonResponse(200, { ok: true, mode: ctx.runtimeMode ?? "hosted", actionExecution: ACTION_EXECUTION }, cors);
  }
  if (method === "POST" && pathname === "/api/login") {
    return handleLogin(request, url, env, cors);
  }

  // ── Auth gate (fail-closed) ──────────────────────────────────────────────
  const auth = authenticateCockpitRequest(request, env);
  if (!auth.ok) {
    // The UI shows a login screen (or a locked page when misconfigured); API
    // routes return 401. Either way no protected data is served.
    if (method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      return htmlResponse(auth.mode === "misconfigured" ? renderLockedPage() : renderLoginPage(), cors);
    }
    return unauthorized(cors, auth);
  }

  if (method === "GET") {
    if (pathname === "/" || pathname === "/index.html") {
      return htmlResponse(ctx.html ?? hostedHtml(ctx), cors);
    }
    if (pathname === "/api/state") {
      return jsonResponse(200, ctx.state ?? { hosted: true, note: "snapshot not embedded" }, cors);
    }
    if (pathname === "/api/reports") {
      return jsonResponse(200, { reports: ctx.reports ?? [] }, cors);
    }
    if (pathname === "/api/threads") {
      return jsonResponse(200, { threads: ctx.threads ?? [] }, cors);
    }
    if (pathname === "/api/freshness") {
      const fr = freshnessView(ctx.state, nowFor(ctx));
      return jsonResponse(
        200,
        fr ?? { available: false, note: "Freshness is unavailable in this snapshot (no live panels embedded)." },
        cors
      );
    }
    if (pathname === "/api/read-models/status") {
      return jsonResponse(200, readModelStatusView(ctx.state), cors);
    }
    if (pathname === "/api/proposals") {
      return jsonResponse(200, proposalsView(ctx.state), cors);
    }
    if (pathname === "/api/debug/status") {
      // Safe, redacted metadata ONLY — presence, never values.
      return jsonResponse(
        200,
        {
          runtimeMode: ctx.runtimeMode ?? "hosted",
          routes: [...SUPPORTED_ROUTES],
          actionExecution: ACTION_EXECUTION,
          mutationEndpoints: MUTATION_ENDPOINTS,
          llmNetworkEnabled: resolveLlmNetworkGate(env),
          envPresence: summarizeEnvPresence(env),
          generatedAt: ctx.generatedAt ?? null,
        },
        cors
      );
    }
    return notFound(cors);
  }

  // POST — only validated, read-only routes (no fs, no network, no mutation).
  if (method === "POST") {
    if (pathname !== "/api/orchestrator/message" && pathname !== "/api/ask") return notFound(cors);

    const raw = await request.text();
    if (raw.length > MAX_REQUEST_BODY_BYTES) return payloadTooLarge(cors);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.length > 0 ? raw : "{}");
    } catch {
      return safeError(400, "Invalid JSON body.", cors);
    }

    const requestText = (parsed as { request?: unknown }).request;
    const validation = validateRequest(requestText);
    if (!validation.ok || !validation.value) {
      return safeError(400, validation.error ?? "Invalid request.", cors);
    }

    // /api/ask — grounded, deterministic intent routing over the snapshot
    // (includes the Daily Command Brief + freshness + ops answers). Status,
    // brief, and freshness questions create ZERO proposals; only explicit
    // proposal/plan language yields non-persisted dry-run drafts.
    if (pathname === "/api/ask") {
      const result = routeHosted(ctx.state, validation.value, nowFor(ctx));
      return jsonResponse(
        200,
        {
          ok: true,
          mode: "deterministic",
          provider: "deterministic",
          request: validation.value,
          intent: result.intent,
          title: result.title,
          summary: result.summary,
          highlights: result.highlights,
          gaps: result.gaps,
          nextSteps: result.nextSteps,
          suggestedCommands: result.suggestedCommands,
          clarifyingQuestion: result.clarifyingQuestion,
          proposalCount: result.proposals.length,
          proposals: result.proposals.map((p) => ({
            id: p.id,
            domain: p.domain,
            actionType: p.actionType,
            title: p.title,
            riskLevel: p.riskLevel,
            status: p.status,
            executable: false as const,
          })),
          actionExecution: ACTION_EXECUTION,
          mutationEndpoints: MUTATION_ENDPOINTS,
        },
        cors
      );
    }

    // /api/orchestrator/message — deterministic classification (Phase 11J).
    const out = deterministicOutput({
      type: "classify_and_contextualize",
      request: validation.value,
      context: { source: "cloudflare-cockpit" },
    });
    return jsonResponse(
      200,
      {
        ok: true,
        mode: "deterministic",
        provider: "deterministic",
        request: validation.value,
        intent: out.intent,
        domain: out.domain,
        recommendedSpecialist: out.recommendedSpecialist,
        riskLevel: out.riskLevel,
        nextAction: out.nextAction,
        summary: out.summary,
        actionExecution: ACTION_EXECUTION,
        mutationEndpoints: MUTATION_ENDPOINTS,
      },
      cors
    );
  }

  return methodNotAllowed(cors);
}

/** Resolve the ISO "now" for freshness — the snapshot's generation time. */
function nowFor(ctx: CockpitWorkerContext): string {
  return ctx.generatedAt ?? ctx.state?.generatedAt ?? "";
}

/** Render the hosted page from the context's snapshot (no fs at request time). */
function hostedHtml(ctx: CockpitWorkerContext): string {
  return renderHostedCockpitPage(ctx.state, {
    runtimeMode: ctx.runtimeMode ?? "hosted",
    generatedAt: ctx.generatedAt ?? ctx.state?.generatedAt ?? null,
    now: nowFor(ctx),
  });
}

/** 401 for API routes. Never leaks the token; reports only the auth mode. */
function unauthorized(cors: Record<string, string>, auth: AuthResult): Response {
  return jsonResponse(
    401,
    { error: "Unauthorized.", mode: auth.mode, reason: auth.reason },
    { "www-authenticate": "Bearer", ...cors }
  );
}

/** Validate a login attempt and set a hardened session cookie on success. */
async function handleLogin(
  request: Request,
  url: URL,
  env: CloudflareCockpitEnv,
  cors: Record<string, string>
): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_REQUEST_BODY_BYTES) return payloadTooLarge(cors);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.length > 0 ? raw : "{}");
  } catch {
    return safeError(400, "Invalid JSON body.", cors);
  }
  const result = attemptLogin(env, (parsed as { token?: unknown }).token, { secure: url.protocol === "https:" });
  if (!result.ok || !result.setCookie) {
    return safeError(result.status, result.reason, cors);
  }
  return jsonResponse(200, { ok: true }, { "set-cookie": result.setCookie, ...cors });
}

/**
 * Build a Worker context from the LOCAL cockpit read model. Runs in Node only
 * (dry-run scripts + tests). On a real Worker, a snapshot is baked at deploy
 * time instead — the Worker never calls this.
 */
export async function createCockpitWorkerContext(options: { cwd?: string } = {}): Promise<CockpitWorkerContext> {
  const cwd = options.cwd ?? process.cwd();
  const state = await buildCockpitState({ cwd });
  const html = renderHostedCockpitPage(state, {
    runtimeMode: "hosted",
    generatedAt: state.generatedAt,
    now: state.generatedAt,
  });
  let threads: string[] = [];
  const threadsDir = path.join(cwd, "cockpit-threads");
  if (existsSync(threadsDir)) {
    try {
      threads = (await readdir(threadsDir)).filter((f) => f.startsWith("thread-") && f.endsWith(".json")).sort().reverse();
    } catch {
      threads = [];
    }
  }
  return {
    state,
    html,
    reports: state.reports,
    threads,
    runtimeMode: "hosted",
    generatedAt: state.generatedAt,
  };
}

/**
 * Default export for Cloudflare. Serves a safe placeholder until a snapshot is
 * baked in at deploy time. /health always works. No filesystem access.
 */
export default {
  async fetch(request: Request, env: CloudflareCockpitEnv): Promise<Response> {
    return handleCockpitRequest(request, env, { runtimeMode: "hosted" });
  },
};
