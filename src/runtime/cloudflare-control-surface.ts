/**
 * src/runtime/cloudflare-control-surface.ts
 *
 * Phase 18F — Hosted Live Read-Only Cockpit (the 18E control surface, served).
 *
 * Resolves the 18E control surface LIVE at Worker request time from the
 * Cloudflare env, reusing the 18E assembler/rules/summarizer/render. Deterministic
 * facts/verdict/confidence/severity are computed server-side; the LLM (default
 * deterministic) may only summarize/select/explain.
 *
 * Hard boundaries (Phase 18F):
 *   - READ-ONLY. Fitness/Ops come through the existing read-only, service-role-
 *     refusing SupabaseReadClient (allowlisted read RPCs only). No mutation.
 *   - NO FILESYSTEM at request time. Inputs are assembled from env + the in-memory
 *     hosted read-model registry; the disk-based input loader from the 18E module
 *     is never imported or called here.
 *   - NO SECRETS to the browser. Keys are sent only as server-side request
 *     headers; the JSON payload is run through `assertNoSecrets` before it leaves.
 *   - GRACEFUL DEGRADATION. A domain whose env is absent or whose read fails
 *     renders as an honest UNKNOWN card — never a crash, never a fabricated value.
 *   - Tax/Factory/runtime/proposals are LOCAL-ONLY; hosted renders them as honest
 *     UNKNOWN ("local-only — not served in hosted read-only mode").
 */

import { assertNoSecrets } from "../llm/redaction.js";
import { buildReadModelRegistrySummary, type ClientFactory } from "../read-models/read-model-report.js";
import type { ReadModelSummary } from "../read-models/read-model-types.js";
import {
  buildHostedReadModelRegistry,
  hostedReadModelsConfigured,
} from "./cloudflare-live-read-models.js";
import {
  buildControlSurfaceState,
  deterministicSummarizer,
  renderControlSurfaceHtml,
  bundleToClientPayload,
  attentionToClientPayload,
  type ControlSurfaceInputs,
  type ControlSurfaceRender,
  type FactSummarizer,
  type HealthCheck,
  type ReadModelInput,
  type UnavailableAgentSpec,
} from "../cockpit/control-surface/index.js";

type Env = Record<string, string | undefined>;

/** The agents that are local-only and therefore honestly UNKNOWN when hosted. */
const HOSTED_UNAVAILABLE_REASON = "local-only — not served in hosted read-only mode";
const HOSTED_UNAVAILABLE_AGENTS: UnavailableAgentSpec[] = [
  { agentId: "tax", name: "Tax Agent", icon: "🧾", purpose: "Generated agent — runtime status is local-only.", reason: HOSTED_UNAVAILABLE_REASON },
  { agentId: "factory", name: "Agent Factory", icon: "🏭", purpose: "The build line — build/test status is local-only.", reason: HOSTED_UNAVAILABLE_REASON },
];

export interface ResolveHostedControlSurfaceOptions {
  /** ISO "now". Defaults to a fresh Date at call time (Workers support Date). */
  now?: string;
  /** Read-only client factory passthrough (tests inject a fetch-stubbed client). */
  clientFactory?: ClientFactory;
  /** Summarizer override (tests inject). Defaults to the offline deterministic one. */
  summarizer?: FactSummarizer;
}

/** Map a live read-model summary into the 18E ReadModelInput. Absent/failed → not live → UNKNOWN. */
function mapReadModel(summary: ReadModelSummary | undefined): ReadModelInput {
  const live = summary?.status === "ok";
  return { live, metrics: summary?.metrics ?? {}, dataFreshness: summary?.dataFreshness ?? null };
}

/**
 * Build the 18E control-surface inputs from the Worker env. PURE w.r.t. the
 * filesystem (no disk). Fitness/Ops are resolved live read-only; Tax/Factory are
 * surfaced as honest UNKNOWN. Never throws for a single-domain failure.
 */
export async function buildHostedControlSurfaceInputs(
  env: Env,
  now: string,
  options: ResolveHostedControlSurfaceOptions = {}
): Promise<ControlSurfaceInputs> {
  const registry = buildHostedReadModelRegistry();
  const readModels = await buildReadModelRegistrySummary({
    env,
    registry,
    ...(options.clientFactory ? { clientFactory: options.clientFactory } : {}),
  });

  const fitness = mapReadModel(readModels.summaries.find((s) => s.type === "fitness"));
  const ops = mapReadModel(readModels.summaries.find((s) => s.type === "ops"));

  const systemHealth: HealthCheck[] = [
    { name: "Fitness Supabase", state: fitness.live ? "g" : "unknown", detail: fitness.live ? "live (read-only)" : "not configured / unreachable" },
    { name: "Ops Supabase", state: ops.live ? "g" : "unknown", detail: ops.live ? "live (read-only)" : "not configured / unreachable" },
  ];

  return {
    now,
    tax: null,
    fitness,
    ops,
    factory: null,
    systemHealth,
    proposalQueue: { needsApproval: 0, readyLocal: 0, blocked: 0, completed: 0 },
    recentActivity: [],
    unavailableAgents: HOSTED_UNAVAILABLE_AGENTS,
  };
}

/** All-UNKNOWN inputs — the safe fallback if input assembly itself fails. */
function degradedInputs(now: string): ControlSurfaceInputs {
  return {
    now,
    tax: null,
    fitness: { live: false, metrics: {}, dataFreshness: null },
    ops: { live: false, metrics: {}, dataFreshness: null },
    factory: null,
    systemHealth: [
      { name: "Fitness Supabase", state: "unknown", detail: "unavailable" },
      { name: "Ops Supabase", state: "unknown", detail: "unavailable" },
    ],
    proposalQueue: { needsApproval: 0, readyLocal: 0, blocked: 0, completed: 0 },
    recentActivity: [],
    unavailableAgents: HOSTED_UNAVAILABLE_AGENTS,
  };
}

/**
 * Resolve the live hosted control-surface render. ALWAYS returns a render (never
 * null): when no read-model env is configured, every domain is honestly UNKNOWN.
 * A hard failure degrades to the all-UNKNOWN surface rather than crashing.
 */
export async function resolveHostedControlSurface(
  env: Env,
  options: ResolveHostedControlSurfaceOptions = {}
): Promise<ControlSurfaceRender> {
  const now = options.now ?? new Date().toISOString();
  let inputs: ControlSurfaceInputs;
  try {
    inputs = await buildHostedControlSurfaceInputs(env, now, options);
  } catch {
    inputs = degradedInputs(now);
  }
  try {
    return await buildControlSurfaceState({
      inputs,
      now,
      summarizer: options.summarizer ?? deterministicSummarizer,
    });
  } catch {
    return buildControlSurfaceState({ inputs: degradedInputs(now), now, summarizer: deterministicSummarizer });
  }
}

/** True when at least one hosted read-model domain has both URL + read-only key. */
export function hostedControlSurfaceConfigured(env: Env): boolean {
  return hostedReadModelsConfigured(env);
}

export interface HostedControlSurfaceJson {
  generatedAt: string;
  systemVerdict: ControlSurfaceRender["systemVerdict"];
  refreshedLabel: string;
  agents: ReturnType<typeof bundleToClientPayload>[];
  attention: ReturnType<typeof attentionToClientPayload>[];
  systemHealth: HealthCheck[];
  proposalQueue: ControlSurfaceRender["proposalQueue"];
  recentActivity: ControlSurfaceRender["recentActivity"];
  builder: ControlSurfaceRender["builder"];
  actionExecution: "disabled";
  mutationEndpoints: "none";
}

/**
 * Build the sanitized JSON payload for GET /api/control-surface. Runs the entire
 * payload through `assertNoSecrets` before returning — if anything secret-looking
 * slipped in, it throws and the route degrades rather than leaking.
 */
export function hostedControlSurfaceJson(
  state: ControlSurfaceRender,
  options: { refreshedLabel?: string } = {}
): HostedControlSurfaceJson {
  const payload: HostedControlSurfaceJson = {
    generatedAt: state.generatedAt,
    systemVerdict: state.systemVerdict,
    refreshedLabel: options.refreshedLabel ?? `as of ${state.generatedAt}`,
    agents: state.bundles.map(bundleToClientPayload),
    attention: state.attention.map(attentionToClientPayload),
    systemHealth: state.systemHealth,
    proposalQueue: state.proposalQueue,
    recentActivity: state.recentActivity,
    builder: state.builder,
    actionExecution: "disabled",
    mutationEndpoints: "none",
  };
  assertNoSecrets(payload, "control-surface-json");
  return payload;
}

/** Render the hosted control-surface HTML page with live in-place refresh wired. */
export function renderHostedControlSurfacePage(
  state: ControlSurfaceRender,
  options: { apiRefreshPath?: string; refreshMs?: number } = {}
): string {
  return renderControlSurfaceHtml(state, {
    apiRefreshPath: options.apiRefreshPath ?? "/api/control-surface",
    refreshMs: options.refreshMs ?? 0,
  });
}
