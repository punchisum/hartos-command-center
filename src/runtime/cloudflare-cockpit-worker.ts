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
  renderAgentDetailPage,
} from "./cloudflare-cockpit-page.js";
import { routeHosted, freshnessView, readModelStatusView, proposalsView, fleetView } from "./cloudflare-cockpit-views.js";
import {
  resolveHostedCockpitState,
  resolveAgentDetail,
  persistCockpitProposals,
  type ProposalPersistResult,
} from "./cloudflare-live-read-models.js";
import {
  resolveHostedControlSurface,
  hostedControlSurfaceJson,
  renderHostedControlSurfacePage,
} from "./cloudflare-control-surface.js";
import type { ControlSurfaceRender } from "../cockpit/control-surface/index.js";

export const SUPPORTED_ROUTES = [
  "GET /",
  "GET /control",
  "GET /health",
  "GET /api/state",
  "GET /api/control-surface",
  "GET /api/reports",
  "GET /api/threads",
  "GET /api/freshness",
  "GET /api/read-models/status",
  "GET /api/fleet",
  "GET /agent/fitness",
  "GET /agent/ops",
  "GET /agent/fitness/ui",
  "GET /agent/ops/ui",
  "GET /api/proposals",
  "GET /api/debug/status",
  "POST /api/login",
  "POST /api/ask",
  "POST /api/orchestrator/message",
] as const;

/**
 * GET routes that render an HTML page. When unauthenticated, these serve the
 * login form (with a same-origin redirect back) instead of a 401 — so an
 * operator who opens a deep link (e.g. /agent/fitness/ui) lands on sign-in and
 * is returned to the page they wanted. Every other route fails closed with 401.
 */
const HTML_GET_ROUTES = new Set<string>([
  "/",
  "/index.html",
  "/control",
  "/agent/fitness/ui",
  "/agent/ops/ui",
]);

/** Generic per-agent route shapes — /agent/<domain> (JSON), /agent/<domain>/ui (HTML). */
const AGENT_UI_RE = /^\/agent\/[a-z0-9_-]+\/ui$/i;
const AGENT_JSON_RE = /^\/agent\/[a-z0-9_-]+$/i;

/** Any GET that renders an HTML page → unauthenticated requests get the login form. */
function isHtmlGetRoute(pathname: string): boolean {
  return HTML_GET_ROUTES.has(pathname) || AGENT_UI_RE.test(pathname);
}

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
    // routes return 401. Either way no protected data is served. The control
    // surface (/control) is a UI page too, so it gets the login form and lands
    // the operator back on /control after a successful sign-in.
    if (method === "GET" && isHtmlGetRoute(pathname)) {
      if (auth.mode === "misconfigured") return htmlResponse(renderLockedPage(), cors);
      const redirectTo = pathname === "/index.html" ? "/" : pathname;
      return htmlResponse(renderLoginPage({ redirectTo }), cors);
    }
    return unauthorized(cors, auth);
  }

  // Phase 16D — lazily resolve LIVE read-model state once, AFTER auth, and only
  // for routes that actually render data. /health, OPTIONS, /api/login, and
  // unauthenticated requests never reach here, so they never trigger a read.
  const dctx = await ensureLiveState(ctx, pathname);

  if (method === "GET") {
    // ── Phase 18F — hosted live control surface (the 18E surface + JSON API) ──
    if (pathname === "/control" || pathname === "/api/control-surface") {
      const cs = await resolveControlSurface(ctx, pathname);
      if (pathname === "/control") {
        return htmlResponse(controlSurfaceHtml(cs), cors);
      }
      // GET /api/control-surface — sanitized, read-only JSON.
      if (!cs) {
        return jsonResponse(
          200,
          {
            available: false,
            systemVerdict: "UNKNOWN",
            note: "Live control surface unavailable (no read-model env resolved).",
            actionExecution: ACTION_EXECUTION,
            mutationEndpoints: MUTATION_ENDPOINTS,
          },
          cors
        );
      }
      try {
        return jsonResponse(200, hostedControlSurfaceJson(cs), cors);
      } catch {
        // assertNoSecrets tripped (should never happen) — fail closed, never leak.
        return jsonResponse(200, { available: false, systemVerdict: "UNKNOWN", note: "Sanitization guard tripped." }, cors);
      }
    }

    if (pathname === "/" || pathname === "/index.html") {
      return htmlResponse(dctx.html ?? hostedHtml(dctx), cors);
    }
    if (pathname === "/api/state") {
      return jsonResponse(200, dctx.state ?? { hosted: true, note: "snapshot not embedded" }, cors);
    }
    if (pathname === "/api/reports") {
      return jsonResponse(200, { reports: ctx.reports ?? [] }, cors);
    }
    if (pathname === "/api/threads") {
      return jsonResponse(200, { threads: ctx.threads ?? [] }, cors);
    }
    if (pathname === "/api/freshness") {
      const fr = freshnessView(dctx.state, nowFor(dctx));
      return jsonResponse(
        200,
        fr ?? { available: false, note: "Freshness is unavailable (no live read-model data resolved)." },
        cors
      );
    }
    if (pathname === "/api/read-models/status") {
      return jsonResponse(200, readModelStatusView(dctx.state), cors);
    }
    if (pathname === "/api/fleet") {
      // Workstream C — unified cross-agent fleet view (read-only). Both agents
      // mapped onto the shared AgentSignal from the live read-model summaries.
      return jsonResponse(200, fleetView(dctx.state, nowFor(dctx)), cors);
    }
    // Phase C / Gap C — per-agent detail for ANY domain: fitness/ops bespoke, or a
    // registered generic agent — with no bespoke route code per agent. /agent/<domain>
    // = read-only JSON; /agent/<domain>/ui = the full dashboard page. A null detail
    // yields an honest "unavailable" payload/page rather than fabricated data.
    const agentUiDomain = AGENT_UI_RE.test(pathname) ? pathname.slice(7, -3) : null;
    if (agentUiDomain) {
      const detail = ctx.agentDetailProvider ? await ctx.agentDetailProvider(agentUiDomain) : null;
      return htmlResponse(renderAgentDetailPage(detail, agentUiDomain), cors);
    }
    const agentJsonDomain = AGENT_JSON_RE.test(pathname) ? pathname.slice(7) : null;
    if (agentJsonDomain) {
      const detail = ctx.agentDetailProvider ? await ctx.agentDetailProvider(agentJsonDomain) : null;
      return jsonResponse(
        200,
        detail ?? { available: false, type: agentJsonDomain, note: `${agentJsonDomain} detail unavailable (no live read-model env resolved).` },
        cors,
      );
    }
    if (pathname === "/api/proposals") {
      return jsonResponse(200, proposalsView(dctx.state), cors);
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
      const result = routeHosted(dctx.state, validation.value, nowFor(dctx));
      // Phase E (Gap E) — when the deterministic answer produced proposal drafts,
      // persist them into the Supabase spine via the gated writer (propose-only;
      // the Worker holds no DB key). Best-effort: persistence never blocks or
      // breaks the answer, and stays advisory when the writer isn't configured.
      let persistence: ProposalPersistResult = { attempted: false, persisted: 0, failed: 0, reason: "no proposals generated" };
      if (result.proposals.length > 0 && ctx.proposalWriteProvider) {
        persistence = await ctx
          .proposalWriteProvider(result.proposals, validation.value)
          .catch(() => ({ attempted: true, persisted: 0, failed: result.proposals.length, reason: "writer error" }));
      }
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
          persistence,
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

/** Routes that render read-model data; only these trigger a live resolve. */
const LIVE_DATA_ROUTES = new Set<string>([
  "/",
  "/index.html",
  "/api/state",
  "/api/freshness",
  "/api/read-models/status",
  "/api/fleet",
  "/api/proposals",
  "/api/ask",
]);

/**
 * Phase 18F — resolve the live control-surface render once per request for the
 * two control routes, AFTER auth. Returns null when no provider is set or it
 * declines/fails; callers then serve the honest UNKNOWN placeholder.
 */
async function resolveControlSurface(
  ctx: CockpitWorkerContext,
  pathname: string
): Promise<ControlSurfaceRender | null> {
  if (!ctx.controlSurfaceProvider) return null;
  if (pathname !== "/control" && pathname !== "/api/control-surface") return null;
  try {
    return (await ctx.controlSurfaceProvider()) ?? null;
  } catch {
    return null; // graceful degradation — never crash the route
  }
}

/** Render the hosted control-surface page, or a safe placeholder if unavailable. */
function controlSurfaceHtml(cs: ControlSurfaceRender | null): string {
  if (!cs) {
    return renderLockedControlSurfacePlaceholder();
  }
  return renderHostedControlSurfacePage(cs, { apiRefreshPath: "/api/control-surface", refreshMs: 0 });
}

/** Minimal honest placeholder when the live control surface can't be resolved. */
function renderLockedControlSurfacePlaceholder(): string {
  return [
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "<title>HartOS — Control Surface (unavailable)</title></head>",
    "<body style=\"font-family:-apple-system,Segoe UI,sans-serif;background:#f3f6fa;color:#1b2532;padding:40px\">",
    "<h1 style=\"font-size:20px\">Control surface unavailable</h1>",
    "<p>No live read-model data could be resolved. System status is <b>UNKNOWN</b> — nothing is being fabricated.</p>",
    "<p style=\"color:#5f6e80;font-size:13px\">This is a read-only surface. No actions, no mutation.</p>",
    "</body></html>",
  ].join("");
}

/**
 * Phase 16D — resolve LIVE read-model state lazily, at most once per request.
 * Returns the original ctx unchanged when: state is already embedded (tests /
 * dry-run snapshots), no live provider is set, the route needs no data, the
 * provider declines (no env configured → null), or the read fails. In every
 * fallback case the existing safe behaviour is preserved.
 */
async function ensureLiveState(ctx: CockpitWorkerContext, pathname: string): Promise<CockpitWorkerContext> {
  if (ctx.state || !ctx.liveStateProvider || !LIVE_DATA_ROUTES.has(pathname)) return ctx;
  try {
    const state = await ctx.liveStateProvider();
    if (state) {
      return { ...ctx, state, generatedAt: ctx.generatedAt ?? state.generatedAt };
    }
  } catch {
    // Graceful degradation — fall through to the placeholder behaviour.
  }
  return ctx;
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
 * Default export for Cloudflare. Phase 16D — serves LIVE read-model data,
 * resolved at request time from the Worker env using read-only anon keys, with
 * graceful per-domain degradation. When no read-model env is configured the
 * provider returns null and the cockpit falls back to the safe placeholder.
 * /health always works. No filesystem access at request time.
 */
export default {
  async fetch(request: Request, env: CloudflareCockpitEnv): Promise<Response> {
    return handleCockpitRequest(request, env, {
      runtimeMode: "hosted",
      liveStateProvider: async () => (await resolveHostedCockpitState(env)) ?? undefined,
      // Phase 18F — live 18E control surface (read-only). Always resolves a render
      // (honest UNKNOWN when nothing is configured); never throws.
      controlSurfaceProvider: async () => resolveHostedControlSurface(env),
      agentDetailProvider: async (domain) => resolveAgentDetail(env, domain),
      proposalWriteProvider: async (proposals, sourceIntent) => persistCockpitProposals(env, proposals, { sourceIntent }),
    });
  },
};
