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
// Worker-safe Ask orchestrator (LLM Ask 2A): composeAskAnswer takes inference INJECTED and
// returns the deterministic grounding unchanged when askInfer is absent.
import { composeAskAnswer } from "../llm/ask-llm.js";
// Step 3 (Worker-direct Ask) — we DELIBERATELY wire the key-bearing gateway into the hosted
// Worker via buildAskInfer. Safe under nodejs_compat: the gateway uses node:path at construction
// (supported) and usage-logging (node:fs) stays OFF (writeUsage defaults false), so nothing fs is
// called on the request path. The gateway SELF-GATES (HARTOS_LLM_PROVIDER=openai +
// HARTOS_LLM_ENABLE_NETWORK=true + OPENAI_API_KEY) and is propose-only; absent the gate it is
// deterministic, identical to before. OPENAI_API_KEY is a server-side Worker secret, never sent
// to the browser. (Supersedes the earlier "never import the gateway" rule, by Hart's decision.)
import { buildAskInfer } from "../llm/run-ask-llm.js";
import { explainGate, resolveLlmConfig } from "../llm/llm-gateway.js";
// Rinnegan — the context compiler is PURE/Worker-safe; the Worker compiles the briefing in-request
// from the Supabase context pack + live facts + memory. (No vault fs access in the Worker.)
import { compileContext, toBriefing } from "../rinnegan/rinnegan-compiler.js";
import { executiveMemory } from "../awareness/executive-memory.js";
import type { RinneganFact, RinneganPattern } from "../rinnegan/rinnegan-types.js";
import { augmentGroundingWithSynthesis } from "../llm/ask-fleet-grounding.js";
import { augmentGroundingWithForecast } from "../llm/ask-forecast-grounding.js";
import { augmentGroundingWithDecisions } from "../llm/ask-decision-grounding.js";
import { buildCockpitState } from "../cockpit/cockpit-read-model.js";
import { composeKnowledgeSurface, deriveKnowledgeInputs, type KnowledgeSurface } from "../cockpit/knowledge-surface.js";
import { routeCockpitCommand } from "../cockpit/command-router.js";
import { decide, autonomyTierLabel, type ConciergeDecision } from "../cockpit/decision-engine.js";
import { resolveMetaAgentRegistry } from "../agents/meta-agent-registry.js";
import { renderCockpitV5, buildCockpitV5Data } from "./cloudflare-cockpit-v5.js";
import type { CockpitV5Data } from "./cloudflare-cockpit-v5.js";
import { assessFleetLiveness, heartbeatsFromReadModels } from "../sentinel/sentinel-liveness.js";
import { heartbeatShouldAlert, buildHeartbeatAlert, heartbeatLogLine } from "../sentinel/sentinel-heartbeat.js";
import { parseDaemonRpcResult, daemonAlert } from "../telegram/daemon-deadman.js";
import { telegramNotifyConfig, formatAlert } from "../telegram/alert-bus.js";
import { TelegramHttpSender } from "../telegram/sender.js";
import { jobSpecFromRoute, buildAgentJobProposal } from "../jobs/agent-job.js";
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
  type HostedPageOptions,
} from "./cloudflare-cockpit-page.js";
import { routeHosted, freshnessView, readModelStatusView, proposalsView, fleetView, cockpitSuggestions } from "./cloudflare-cockpit-views.js";
import { fetchLiveThreads, fetchLiveProposals } from "./cloudflare-live-cockpit-feeds.js";
import { mutationCenterView } from "./views/mutation-center-view.js";
import { fleetBriefingView } from "./views/fleet-brain-view.js";
import { mutationDispatchView } from "./views/mutation-dispatch-view.js";
import { auditTailView } from "./views/audit-tail-view.js";
import { recentActivityView } from "./views/recent-activity-view.js";
import { fleetSynthesisView } from "./views/fleet-synthesis-view.js";
import { auditRowsFromProposals } from "./views/audit-from-proposals.js";
import { autonomyPreviewView } from "./views/autonomy-preview-view.js";
import { factoryJobView } from "./views/factory-job-view.js";
import { suggestionToProposal } from "../cockpit/suggestions/suggest-actions.js";
import { stableProposalId } from "../cockpit/proposals/cockpit-proposal-spine.js";
import {
  resolveHostedCockpitState,
  resolveAgentDetail,
  persistCockpitProposals,
  transitionCockpitProposal,
  resolveCockpitThreads,
  resolveRecentPulseRuns,
  resolveContextPack,
  type ProposalPersistResult,
  type ProposalTransitionResult,
} from "./cloudflare-live-read-models.js";
import {
  resolveHostedControlSurface,
  hostedControlSurfaceJson,
  renderHostedControlSurfacePage,
} from "./cloudflare-control-surface.js";
import type { ControlSurfaceRender } from "../cockpit/control-surface/index.js";
import type { CockpitThreadSummary } from "../cockpit/threads/cockpit-thread-spine.js";
import type { PulseRun } from "../cockpit/pulse/pulse-run-spine.js";

export const SUPPORTED_ROUTES = [
  "GET /",
  "GET /control",
  "GET /health",
  "GET /api/state",
  "GET /api/v5",
  "GET /api/control-surface",
  "GET /api/reports",
  "GET /api/threads",
  "GET /api/freshness",
  "GET /api/read-models/status",
  "GET /api/liveness",
  "GET /api/fleet",
  "GET /api/fleet-brain",
  "GET /api/fleet-synthesis",
  "GET /api/autonomy-preview",
  "GET /api/mutation-center",
  "GET /api/mutation-dispatch",
  "GET /api/factory-job",
  "GET /api/audit-tail",
  "GET /api/recent-activity",
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
/** Build the live v5 cockpit data (shared by GET / and the GET /api/v5 polling endpoint). */
function buildV5DataForRequest(
  env: CloudflareCockpitEnv,
  now: string,
  state: Parameters<typeof fleetSynthesisView>[0],
): CockpitV5Data {
  const reg = resolveMetaAgentRegistry({ now });
  const cfg = resolveLlmConfig(env);
  // Prophet cross-fleet synthesis — derived from in-memory state (cheap, safe for the 6s poll).
  const syn = fleetSynthesisView(state, now);
  const intelligence = syn.available
    ? {
        available: true,
        confidence: String(syn.confidence ?? "unknown"),
        note: syn.note ?? "",
        risks: (syn.topRisks ?? []).slice(0, 8).map((r) => ({
          subject: String(r.subject ?? ""),
          severity: String(r.severity ?? "low"),
          why: String(r.why ?? ""),
        })),
      }
    : { available: false, confidence: "unknown", note: syn.note ?? "Synthesis unavailable — read-models not resolved.", risks: [] };
  return buildCockpitV5Data(reg.agents, state?.proposalQueue, {
    now,
    buildSha: (env["BUILD_SHA"] ?? null) as string | null,
    diagnostics: {
      providerMode: explainGate(cfg).mode,
      model: cfg.model,
      llmNetwork: resolveLlmNetworkGate(env),
      writePathConfigured: Boolean(env["HARTOS_ASK_WRITE_URL"] && env["HARTOS_ASK_WRITE_TOKEN"]),
      env: summarizeEnvPresence(env),
    },
    intelligence,
  });
}

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
  // /health is a safe uptime check (no secrets). /api/login is the auth entry. Deploy provenance
  // (git SHA + build time) is injected via the BUILD_SHA / BUILD_TIME vars at deploy time
  // (wrangler deploy --var BUILD_SHA:$(git rev-parse --short HEAD) …) so you can tell WHICH code is
  // live — the prerequisite for trustworthy rollback. Null when not supplied (no secret, additive).
  if (method === "GET" && pathname === "/health") {
    return jsonResponse(
      200,
      {
        ok: true,
        mode: ctx.runtimeMode ?? "hosted",
        actionExecution: ACTION_EXECUTION,
        version: env["BUILD_SHA"] ?? null,
        builtAt: env["BUILD_TIME"] ?? null,
      },
      cors,
    );
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
      // v5 "Neural Deck" — flag-gated (HARTOS_COCKPIT_V5=true) or previewable via ?v5=1. Renders the
      // connectome cockpit + Live Operations page, hydrated from the live registry + proposal spine.
      if (env["HARTOS_COCKPIT_V5"] === "true" || url.searchParams.get("v5") === "1") {
        return htmlResponse(renderCockpitV5(buildV5DataForRequest(env, nowFor(dctx), dctx.state)), cors);
      }
      if (dctx.html) return htmlResponse(dctx.html, cors);
      // Phase D — surface recent threads from the spine in the activity panel.
      const threads = dctx.threadsProvider ? await dctx.threadsProvider().catch(() => null) : null;
      // Recent autopilot pulse runs — for the Last-Pulse tile + forecast-accuracy scoring.
      const pulseRuns = dctx.pulseRunsProvider ? await dctx.pulseRunsProvider().catch(() => null) : null;
      // Knowledge & Intelligence card — composed from the LIVE vault context pack (best-effort;
      // absent the pack the card renders the honest "nothing filed yet" line). Pure + Worker-safe.
      let knowledge: KnowledgeSurface | undefined;
      let vaultNotesSynced: number | null = null;
      if (dctx.contextPackProvider) {
        try {
          const notes = await dctx.contextPackProvider();
          if (notes && notes.length) {
            vaultNotesSynced = notes.length;
            const derived = deriveKnowledgeInputs(notes);
            knowledge = composeKnowledgeSurface(derived);
          }
        } catch {
          /* best-effort; the page still renders without the card */
        }
      }
      // Technical-page diagnostics — secret-free (gate reason + presence boolean only).
      const dgCfg = resolveLlmConfig(env);
      const dgGate = explainGate(dgCfg);
      const dgReg = resolveMetaAgentRegistry({ now: nowFor(dctx) });
      const diagnostics = {
        providerMode: dgGate.mode,
        gateReason: dgGate.reason,
        model: dgCfg.model,
        apiKeyEffective: dgCfg.apiKeyPresent,
        opsStatus: dgReg.byId["ops"]?.status,
        opsReason: dgReg.byId["ops"]?.statusReason,
        vaultNotesSynced,
        version: (env["BUILD_SHA"] ?? null) as string | null,
      };
      return htmlResponse(hostedHtml(dctx, threads ?? undefined, knowledge, diagnostics, pulseRuns ?? undefined, env["HARTOS_COCKPIT_V4"] === "true"), cors);
    }
    if (pathname === "/api/state") {
      return jsonResponse(200, dctx.state ?? { hosted: true, note: "snapshot not embedded" }, cors);
    }
    if (pathname === "/api/v5") {
      // The live v5 cockpit data — the SAME shape the page injects, resolved fresh each request so
      // the client can poll it and update the connectome / tasks / proposals without a page reload.
      return jsonResponse(200, buildV5DataForRequest(env, nowFor(dctx), dctx.state), cors);
    }
    if (pathname === "/api/agents") {
      // The meta-agent registry (org chart + honest capability/status). Read-only, secret-free.
      const reg = resolveMetaAgentRegistry({ now: nowFor(dctx) });
      return jsonResponse(200, { ok: true, rootId: reg.rootId, counts: reg.counts, agents: reg.agents }, cors);
    }
    if (pathname === "/api/reports") {
      return jsonResponse(200, { reports: ctx.reports ?? [] }, cors);
    }
    if (pathname === "/api/liveness") {
      // Sentinel — fleet liveness from the evidence THIS Worker honestly has: itself (it is
      // answering) + the read-model snapshot/diagnostics. Agents with no Worker-visible
      // evidence stay "unknown" here; the local CLI (npm run sentinel:status) covers
      // artifact-dir evidence. Read-only; never assumes up.
      const reg = resolveMetaAgentRegistry({ now: nowFor(dctx) });
      const rm = readModelStatusView(dctx.state);
      const heartbeats = heartbeatsFromReadModels(rm, nowFor(dctx), ctx.generatedAt ?? null);
      return jsonResponse(200, assessFleetLiveness(reg, heartbeats, nowFor(dctx)), cors);
    }
    if (pathname === "/api/threads") {
      // Phase D — prefer the Supabase thread spine (so the hosted Worker shows
      // threads that are no longer local-only); fall back to the local list,
      // then the live read-only feed from the fitness project's cockpit RPCs,
      // then an explicit empty fallback.
      if (ctx.threadsProvider) {
        const threads = await ctx.threadsProvider().catch(() => null);
        if (threads) return jsonResponse(200, { threads }, cors);
      }
      if (ctx.threads && ctx.threads.length > 0) {
        return jsonResponse(200, { threads: ctx.threads }, cors);
      }
      const liveThreads = await fetchLiveThreads(env);
      return jsonResponse(
        200,
        liveThreads ?? {
          threads: [],
          note: "No local snapshot and no live cockpit feed configured (set HARTOS_FITNESS_SUPABASE_URL + HARTOS_FITNESS_SUPABASE_READONLY_KEY).",
        },
        cors
      );
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
    if (pathname === "/api/fleet-brain") {
      // Rule-first Fleet Brain — delta-aware prioritized briefing over the same
      // live signals + proposal queue. Read-only projection; no LLM, no execute.
      return jsonResponse(200, fleetBriefingView(dctx.state, nowFor(dctx)), cors);
    }
    if (pathname === "/api/fleet-synthesis") {
      // Cross-agent synthesis rollup — top correlated risks across briefing + perception +
      // forecast, with §19-clamped confidence (never laundered). Read-only; no LLM, no execute.
      return jsonResponse(200, fleetSynthesisView(dctx.state, nowFor(dctx)), cors);
    }
    if (pathname === "/api/autonomy-preview") {
      // Read-only preview of what the GATED autonomy loop WOULD queue from the live suggestions —
      // every item is queued + requiredApproval Hart; the loop cannot approve/execute. executable:'disabled'.
      return jsonResponse(200, autonomyPreviewView(dctx.state, nowFor(dctx)), cors);
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
      // Prefer the embedded snapshot; when it is local-only/unavailable, try
      // the live read-only feed before falling back to the local-only note.
      const view = proposalsView(dctx.state, nowFor(dctx));
      if (!view.available) {
        const liveProposals = await fetchLiveProposals(env);
        if (liveProposals) return jsonResponse(200, liveProposals, cors);
      }
      return jsonResponse(200, view, cors);
    }
    if (pathname === "/api/mutation-center") {
      // Read-only Mutation Center — pending-executable proposals with tier/risk/target
      // + tier-payload refusals. executable:'disabled' by construction (no execute wiring).
      return jsonResponse(200, mutationCenterView(dctx.state), cors);
    }
    if (pathname === "/api/factory-job") {
      // Read-only Factory Job view — active Factory jobs + interrogation status.
      // executable:'disabled'; CockpitState does not yet carry factory jobs (go-live wiring).
      return jsonResponse(200, factoryJobView(dctx.state, nowFor(dctx)), cors);
    }
    if (pathname === "/api/mutation-dispatch") {
      // Read-only dispatch-readiness — which gated adapter would run each pending-executable
      // proposal + a COPYABLE dry-run `mutate` command. executable:'disabled'; nothing fires here.
      return jsonResponse(200, mutationDispatchView(dctx.state), cors);
    }
    if (pathname === "/api/audit-tail") {
      // Read-only audit-trail projection sourced from the proposals' OWN append-only auditEvents in
      // the live snapshot (zero new infra). The pg reader stays Node-only/off-Worker for go-live.
      return jsonResponse(200, auditTailView(auditRowsFromProposals(dctx.state)), cors);
    }
    if (pathname === "/api/recent-activity") {
      // Read-only recent StateDeltas. Honest-unavailable until a delta source is wired (go-live).
      return jsonResponse(200, recentActivityView(undefined), cors);
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
    if (pathname !== "/api/orchestrator/message" && pathname !== "/api/ask" && pathname !== "/api/suggestions/persist" && pathname !== "/api/proposals/transition") return notFound(cors);

    const raw = await request.text();
    if (raw.length > MAX_REQUEST_BODY_BYTES) return payloadTooLarge(cors);

    // /api/suggestions/persist — gated "queue these for approval". Persists the
    // cross-system suggested actions to the spine as DRAFTS, but STATUS-SAFE: it
    // skips any whose stable id already exists in the queue (any status), so it can
    // never overwrite a proposal Hart already approved/rejected. No request body.
    if (pathname === "/api/suggestions/persist") {
      const now = nowFor(dctx);
      const suggestions = cockpitSuggestions(dctx.state, now);
      const drafts = suggestions.actions.map((a) => suggestionToProposal(a, now));
      const existing = new Set((dctx.state?.proposalQueue ?? []).map((p) => p.id));
      const fresh = drafts.filter((d) => !existing.has(stableProposalId(d.domain, d.actionType, d.title)));
      const alreadyQueued = drafts.length - fresh.length;
      let persistence: ProposalPersistResult = { attempted: false, persisted: 0, failed: 0, reason: "nothing new to queue" };
      if (fresh.length > 0 && ctx.proposalWriteProvider) {
        persistence = await ctx
          .proposalWriteProvider(fresh, "suggested-actions")
          .catch(() => ({ attempted: true, persisted: 0, failed: fresh.length, reason: "writer error" }));
      } else if (fresh.length > 0) {
        persistence = { attempted: false, persisted: 0, failed: 0, reason: "write endpoint not configured (advisory-only)" };
      }
      return jsonResponse(
        200,
        { ok: true, candidates: drafts.length, queued: persistence.persisted, alreadyQueued, attempted: persistence.attempted, failed: persistence.failed, reason: persistence.reason },
        cors,
      );
    }

    // /api/proposals/transition — gated approve/reject. Relays to the capability-token
    // Edge Function (the Worker holds NO DB key); the Edge Function does the conditional,
    // status-safe write + the append-only audit. Body: { id, action: "approve"|"reject" }.
    if (pathname === "/api/proposals/transition") {
      let body: { id?: unknown; action?: unknown };
      try {
        body = JSON.parse(raw) as { id?: unknown; action?: unknown };
      } catch {
        return jsonResponse(400, { ok: false, error: "invalid json" }, cors);
      }
      const id = typeof body.id === "string" ? body.id : "";
      const action = body.action === "approve" || body.action === "reject" ? body.action : null;
      if (!id || !action) return jsonResponse(400, { ok: false, error: "id and action (approve|reject) are required" }, cors);
      let result: ProposalTransitionResult = { attempted: false, ok: false, status: null, reason: "transition endpoint not configured (advisory-only)" };
      if (ctx.proposalTransitionProvider) {
        result = await ctx
          .proposalTransitionProvider({ id, action })
          .catch(() => ({ attempted: true, ok: false, status: null, reason: "transition error" }));
      }
      return jsonResponse(200, { ok: result.ok, status: result.status, attempted: result.attempted, reason: result.reason }, cors);
    }

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
      // LLM Ask 2A — route the grounded answer through the Worker-safe orchestrator. With no
      // injected askInfer (the Worker default) `composeAskAnswer` returns the deterministic
      // grounding UNCHANGED (behavior-preserving); a Node/Edge host that injects ctx.askInfer
      // lights up redaction-first, validated, propose-only LLM reasoning. The orchestrator owns
      // only title/summary/highlights/gaps + mode/provider/risk; intent/nextSteps/proposals are
      // the rule-based truth and stay sourced from `result`.
      // L3 — enrich the grounding with the cross-agent fleet-synthesis for fleet/risk intents, so
      // BOTH the deterministic answer (copies highlights/gaps through) AND the LLM path (reasons
      // over the grounding) reflect synthesized fleet intelligence. Non-fleet intents / unavailable
      // synthesis ⇒ grounding unchanged (behavior-preserving); confidence is surfaced verbatim, never laundered.
      const grounding = { summary: result.summary, title: result.title, highlights: result.highlights, gaps: result.gaps };
      const groundedWithSynthesis = augmentGroundingWithSynthesis(grounding, dctx.state, nowFor(dctx), {
        intent: result.intent,
        request: validation.value,
      });
      // Prophet — add the FORWARD-tense layer: ground the answer in what the known issues BECOME if
      // left alone (consequence-of-inaction), so "what's going to bite me?" sees the future, not just
      // the present. Behavior-preserving when there is nothing to forecast (e.g. thin memory).
      const groundedForward = augmentGroundingWithForecast(groundedWithSynthesis, dctx.state, nowFor(dctx), {
        intent: result.intent,
        request: validation.value,
      });
      // Chief-of-Staff — ground strategy/status/daily Asks in the ranked decision synthesis (the
      // 2-3 decisions that matter today, with the ask + cost of waiting). Behavior-preserving when
      // there is nothing to decide.
      const groundedDecisions = augmentGroundingWithDecisions(groundedForward, dctx.state, nowFor(dctx), {
        intent: result.intent,
        request: validation.value,
      });
      // Rinnegan — compile the vault context pack (Supabase mirror) + live facts + memory patterns
      // into a ranked, freshness-tagged briefing so the LLM reasons over MEANING + facts, not facts
      // alone. The compiler is pure (runs in-Worker); best-effort — absent the pack the Ask is unchanged.
      let rinneganBriefing: string | undefined;
      if (ctx.contextPackProvider) {
        try {
          const notes = await ctx.contextPackProvider();
          if (notes && notes.length) {
            const facts: RinneganFact[] = (result.highlights ?? []).map((h) => ({
              label: result.intent,
              value: h,
              source: "read-model",
              freshness: "live",
            }));
            const mem = executiveMemory(dctx.state?.memorySnapshots ?? [], { now: nowFor(dctx) });
            const patterns: RinneganPattern[] =
              mem.status === "ok" ? mem.recurringPatterns.map((p) => ({ subject: p.subject, evidence: p.evidence })) : [];
            // noteSnippetMax raised so the briefing carries a dossier's SUBSTANCE (findings/
            // opportunities), not just its framing — fixes the "knows the dossier, not its content" gap.
            const compiled = compileContext({ intent: validation.value, now: nowFor(dctx), notes, facts, patterns }, { noteSnippetMax: 1400 });
            const briefing = toBriefing(compiled);
            if (briefing) rinneganBriefing = briefing;
          }
        } catch {
          /* briefing is best-effort; the Ask still works without it */
        }
      }
      const answer = await composeAskAnswer(
        groundedDecisions,
        validation.value,
        // intent rides in the context so buildAskInfer can route to the specialized reasoning
        // (strategy/CTO) prompt; source + the optional Rinnegan briefing travel alongside.
        { source: "cloudflare-cockpit", intent: result.intent, ...(rinneganBriefing ? { rinneganBriefing } : {}) },
        { infer: ctx.askInfer },
      );
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
      // Honest gate diagnostics — so "no live LLM was used" is never a silent mystery. Secret-free
      // (explainGate returns only a reason string; resolveLlmConfig's key is never surfaced).
      const gate = explainGate(resolveLlmConfig(env));
      // Command routing — which agent/mode handles this, and how (read-only / gated proposal /
      // requires-runner). Surfaced so agent selection is visible + testable; never silent.
      const route = routeCockpitCommand(validation.value);
      // Autonomy spine: a runner-required action no longer dead-ends — the cockpit CREATES a gated
      // job proposal in the spine (pending_approval). Hart approves in Approvals; the local runner
      // executes it under that action's own env gates. The cockpit itself never executes.
      let jobCreated: { id: string; title: string; persisted: boolean; reason: string } | null = null;
      if (route.needsProposal && route.requiresLocalRunner && ctx.proposalWriteProvider) {
        const spec = jobSpecFromRoute(route);
        if (spec) {
          const jobProposal = buildAgentJobProposal(spec, route, nowFor(dctx));
          const persist = await ctx
            .proposalWriteProvider([jobProposal], `agent-job: ${validation.value}`)
            .catch(() => ({ attempted: true, persisted: 0, failed: 1, reason: "writer error" }));
          jobCreated = {
            id: jobProposal.id,
            title: jobProposal.title,
            persisted: persist.persisted > 0,
            reason: persist.persisted > 0 ? "queued for your approval in Approvals" : persist.reason,
          };
        }
      }
      return jsonResponse(
        200,
        {
          ok: true,
          mode: answer.mode,
          provider: answer.provider,
          usedLlm: answer.usedLlm,
          providerMode: gate.mode,
          gateReason: gate.reason,
          fallbackReason: answer.fallbackReason,
          routing: {
            selectedAgent: route.selectedAgentId,
            selectedAgentName: route.selectedAgentName,
            mode: route.selectedMode,
            intentClass: route.intentClass,
            reason: route.reason,
            confidence: route.confidence,
            directAnswerPossible: route.directAnswerPossible,
            needsProposal: route.needsProposal,
            needsApproval: route.needsApproval,
            requiresLocalRunner: route.requiresLocalRunner,
            fallback: route.fallback,
          },
          jobCreated,
          request: validation.value,
          intent: result.intent,
          title: answer.title,
          summary: answer.summary,
          highlights: answer.highlights,
          gaps: answer.gaps,
          riskLevel: answer.riskLevel,
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
          concierge: conciergeBlock(validation.value),
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
        concierge: conciergeBlock(validation.value),
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

/**
 * Human OS Doctrine §10 — the CONCIERGE block. The decision engine's verdict, serialised for the
 * cockpit: which of the seven terminals this resolves to, the autonomy tier (Tier 0..4), whether it
 * runs now or waits for a gate, and the concierge sections (what matters / next action / risks /
 * opportunities / capability gaps). Pure + read-only + ADDITIVE — it changes no existing response
 * field and executes nothing. Surfaced so every message reads like a chief-of-staff reply, not a
 * dashboard row.
 */
function conciergeBlock(request: string): Record<string, unknown> {
  const d: ConciergeDecision = decide(request);
  return {
    terminal: d.terminal,
    interpretation: d.interpretation,
    domain: d.domain,
    autonomy: {
      tier: d.autonomy.tier,
      tierNumber: d.autonomy.tierNumber,
      label: autonomyTierLabel(d.autonomy.tier),
      floorApplied: d.autonomy.floorApplied,
      defaultedUp: d.autonomy.defaultedUp,
      rationale: d.autonomy.rationale,
    },
    proposalTier: d.proposalTier,
    autohealGoverned: d.autohealGoverned,
    autoExecutableNow: d.autoExecutableNow,
    requiresHumanApproval: d.requiresHumanApproval,
    wouldAutoRunWhenTier1Enabled: d.wouldAutoRunWhenTier1Enabled,
    whatMatters: d.whatMatters,
    recommendedNextAction: d.recommendedNextAction,
    risks: d.risks,
    opportunities: d.opportunities,
    capabilityGaps: d.capabilityGaps,
    proposal: d.proposal,
  };
}

/** Routes that render read-model data; only these trigger a live resolve. */
const LIVE_DATA_ROUTES = new Set<string>([
  "/",
  "/index.html",
  "/api/v5", // the v5 cockpit's 6s poll — MUST resolve live state, else proposals + synthesis go empty
  "/api/state",
  "/api/freshness",
  "/api/read-models/status",
  "/api/fleet",
  "/api/fleet-brain",
  "/api/fleet-synthesis",
  "/api/autonomy-preview",
  "/api/mutation-center",
  "/api/mutation-dispatch",
  "/api/factory-job",
  "/api/audit-tail",
  "/api/proposals",
  "/api/ask",
  "/api/suggestions/persist",
  "/api/proposals/transition",
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
function hostedHtml(
  ctx: CockpitWorkerContext,
  threads?: CockpitThreadSummary[],
  knowledge?: KnowledgeSurface,
  diagnostics?: HostedPageOptions["diagnostics"],
  pulseRuns?: PulseRun[],
  v4?: boolean,
): string {
  return renderHostedCockpitPage(ctx.state, {
    runtimeMode: ctx.runtimeMode ?? "hosted",
    ...(v4 ? { v4: true } : {}),
    generatedAt: ctx.generatedAt ?? ctx.state?.generatedAt ?? null,
    now: nowFor(ctx),
    // Real wall-clock render time so the topbar shows the TRUE data age, not a perpetual "just now".
    // Distinct from the snapshot time (now/generatedAt). Read-only; affects display text only.
    renderedAt: new Date().toISOString(),
    ...(threads ? { threads } : {}),
    ...(knowledge ? { knowledge } : {}),
    ...(diagnostics ? { diagnostics } : {}),
    ...(pulseRuns ? { pulseRuns } : {}),
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
 * Sentinel HEARTBEAT — the Cloudflare cron body. Runs the SAME Worker-visible liveness as
 * /api/liveness (the cockpit itself + the fitness/ops read-models), logs a structured line for
 * observability, and — only on a real freshness failure (stale/down) — POSTs a fact-only alert to
 * HARTOS_SENTINEL_ALERT_WEBHOOK when configured. Detect-only: it never restarts/redeploys anything.
 * Read-only; never throws (the cron must not crash the Worker). "unknown" agents are not alerted.
 */
export async function runSentinelHeartbeat(env: CloudflareCockpitEnv): Promise<void> {
  try {
    const now = new Date().toISOString();
    const reg = resolveMetaAgentRegistry({ now });
    const state = (await resolveHostedCockpitState(env).catch(() => null)) ?? undefined;
    const rm = readModelStatusView(state);
    const heartbeats = heartbeatsFromReadModels(rm, now, state?.generatedAt ?? null);
    const fleet = assessFleetLiveness(reg, heartbeats, now);
    console.log(heartbeatLogLine(fleet));

    if (heartbeatShouldAlert(fleet)) {
      const webhook = env["HARTOS_SENTINEL_ALERT_WEBHOOK"];
      const alert = buildHeartbeatAlert(fleet);
      if (typeof webhook === "string" && webhook.trim().length > 0) {
        await fetch(webhook.trim(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(alert),
        }).catch((err) => console.log(`[sentinel-heartbeat] alert webhook failed: ${String(err)}`));
      } else {
        console.warn(`[sentinel-heartbeat] ALERT (no webhook configured): ${alert.text} — ${alert.agents.join(", ")}`);
      }
    }

    // DEAD-MAN'S-SWITCH: the Worker is the external observer that detects the live-runner daemon's
    // own death (the daemon can't). The RPC does the staleness check + atomic alert-dedup in the DB.
    await checkDaemonDeadman(env);
  } catch (err) {
    // A heartbeat must never crash the scheduled run.
    console.log(`[sentinel-heartbeat] error: ${String(err)}`);
  }
}

/**
 * Read the daemon's liveness via the security-definer RPC (which dedups in the DB) and, when it says
 * to alert, ping Hart on Telegram. Read-only key + a definer RPC; gated by the same ALLOW_TELEGRAM_NOTIFY
 * + token + chat as the rest of the bus. Never throws — the cron must not crash.
 */
async function checkDaemonDeadman(env: CloudflareCockpitEnv): Promise<void> {
  try {
    const url = env["HARTOS_FITNESS_SUPABASE_URL"];
    const key = env["HARTOS_FITNESS_SUPABASE_READONLY_KEY"];
    if (!url || !key) return; // not configured — silent
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/hartos_daemon_liveness_alert`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
      body: "{}",
    });
    if (!res.ok) {
      console.log(`[daemon-deadman] rpc failed (${res.status})`);
      return;
    }
    const parsed = parseDaemonRpcResult(await res.json());
    if (!parsed) return;
    const alert = daemonAlert(parsed);
    if (!alert) return;
    const cfg = telegramNotifyConfig(env, true);
    if (!cfg.ok) {
      console.warn(`[daemon-deadman] ALERT (telegram disarmed): ${alert.title}`);
      return;
    }
    const sender = new TelegramHttpSender(env, { fetchImpl: fetch.bind(globalThis) });
    await sender.sendMessage(cfg.chatId!, formatAlert(alert));
    console.log(`[daemon-deadman] alerted Hart: ${alert.title}`);
  } catch (err) {
    console.log(`[daemon-deadman] error: ${String(err)}`);
  }
}

/**
 * Default export for Cloudflare. Phase 16D — serves LIVE read-model data,
 * resolved at request time from the Worker env using read-only anon keys, with
 * graceful per-domain degradation. When no read-model env is configured the
 * provider returns null and the cockpit falls back to the safe placeholder.
 * /health always works. No filesystem access at request time.
 *
 * `scheduled` is Sentinel's 24/7 heartbeat (cron in wrangler.cockpit.toml). It runs detached via
 * ctx.waitUntil so the tick completes even after the handler returns.
 */
export default {
  async scheduled(
    _event: { cron?: string; scheduledTime?: number },
    env: CloudflareCockpitEnv,
    ctx: { waitUntil(p: Promise<unknown>): void },
  ): Promise<void> {
    ctx.waitUntil(runSentinelHeartbeat(env));
  },
  async fetch(request: Request, env: CloudflareCockpitEnv): Promise<Response> {
    return handleCockpitRequest(request, env, {
      runtimeMode: "hosted",
      liveStateProvider: async () => (await resolveHostedCockpitState(env)) ?? undefined,
      // Phase 18F — live 18E control surface (read-only). Always resolves a render
      // (honest UNKNOWN when nothing is configured); never throws.
      controlSurfaceProvider: async () => resolveHostedControlSurface(env),
      agentDetailProvider: async (domain) => resolveAgentDetail(env, domain),
      proposalWriteProvider: async (proposals, sourceIntent) => persistCockpitProposals(env, proposals, { sourceIntent }),
      proposalTransitionProvider: async (input) => transitionCockpitProposal(env, input),
      threadsProvider: async () => resolveCockpitThreads(env),
      pulseRunsProvider: async () => resolveRecentPulseRuns(env),
      // Step 3 — Worker-direct LLM Ask. Self-gating: a real OpenAI call happens ONLY when the
      // gate is armed (HARTOS_LLM_PROVIDER=openai + HARTOS_LLM_ENABLE_NETWORK=true + OPENAI_API_KEY
      // secret); otherwise deterministic. Propose-only — the LLM reasons, never executes.
      askInfer: buildAskInfer({ env }),
      // Rinnegan — feed the deployed Ask the vault context pack (Worker reads the Supabase mirror).
      contextPackProvider: async () => resolveContextPack(env),
    });
  },
};
