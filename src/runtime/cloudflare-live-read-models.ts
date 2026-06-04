/**
 * src/runtime/cloudflare-live-read-models.ts
 *
 * Phase 16D — Hosted Live Read-Model Runtime.
 *
 * Resolves the Fitness + Ops read-models LIVE at Worker request time, from the
 * Cloudflare env, and assembles a render-ready CockpitState — WITHOUT any
 * filesystem access and WITHOUT exposing any secret to the browser.
 *
 * Doctrine (unchanged from the local cockpit, enforced here too):
 *   - READ-ONLY. The SupabaseReadClient exposes no insert/update/delete/upsert
 *     and no mutation RPC; only allowlisted read RPCs are reachable.
 *   - Read-only ANON keys only. `defaultClientFactory` refuses service-role keys
 *     (isServiceRoleKey) and the keys are sent only as request headers,
 *     server-side — they are NEVER placed in HTML or any JSON response body.
 *   - No filesystem. The read-model registry is built in memory from env here,
 *     so neither `loadReadModelRegistry` nor `process.cwd` is ever touched on
 *     the hosted path.
 *   - Graceful degradation. If a domain's env is absent or a live read fails,
 *     that panel degrades to "unavailable + exact setup step"; the rest of the
 *     cockpit still renders. If NO read-model env is configured at all, this
 *     returns null and the Worker falls back to the safe placeholder.
 *
 * The actual RPC names match the deployed agents:
 *   Ops      → get_ops_overview / _attention_cards / _recent_updates /
 *              _status_counts / _risk_flags        (granted to anon)
 *   Fitness  → get_fitness_today_state / _today_nutrition / _recent_workouts /
 *              _weekly_summary                       (granted to anon; (uuid,uuid) args)
 */

import { CARD_GROUPS } from "../command-center/command-center-types.js";
import type { ActionId, CardGroup } from "../command-center/command-center-types.js";
import { ACTION_STATES } from "../command-center/action-contract.js";
import { FORBIDDEN_OPERATIONS } from "../read-models/read-model-types.js";
import type { ReadModelConfig } from "../read-models/read-model-types.js";
import type { LoadedReadModelRegistry } from "../read-models/read-model-registry.js";
import { buildReadModelRegistrySummary, type ClientFactory } from "../read-models/read-model-report.js";
import { buildDomainPanels, DEFAULT_MODULES, type PanelInputs } from "../cockpit/panels/index.js";
import {
  deriveFitnessSource,
  deriveOpsSource,
  deriveFactorySource,
  buildSourceDiagnostics,
  type ResolvedSources,
  type SourceDiagnosticsReport,
} from "../cockpit/sources/index.js";
import type { AgentIntegrationSummary } from "../agents/agent-types.js";
import type { CockpitState, CockpitCardGroupView } from "../cockpit/cockpit-types.js";

type Env = Record<string, string | undefined>;

/** Env var NAMES the hosted read-models read (never their VALUES). */
export const HOSTED_READ_MODEL_ENV = {
  opsUrl: "HARTOS_OPS_SUPABASE_URL",
  opsKey: "HARTOS_OPS_SUPABASE_READONLY_KEY",
  fitnessUrl: "HARTOS_FITNESS_SUPABASE_URL",
  fitnessKey: "HARTOS_FITNESS_SUPABASE_READONLY_KEY",
  fitnessUserId: "HARTOS_FITNESS_USER_ID",
  fitnessAgentId: "HARTOS_FITNESS_AGENT_ID",
} as const;

/** The deployed read-only RPC allowlists. Anything else is refused by the client. */
export const OPS_ALLOWED_RPCS = [
  "get_ops_overview",
  "get_ops_attention_cards",
  "get_ops_recent_updates",
  "get_ops_status_counts",
  "get_ops_risk_flags",
];
export const FITNESS_ALLOWED_RPCS = [
  "get_fitness_today_state",
  "get_fitness_today_nutrition",
  "get_fitness_recent_workouts",
  "get_fitness_weekly_summary",
];

function present(env: Env, name: string): boolean {
  const v = env[name];
  return typeof v === "string" && v.trim().length > 0;
}

/** True when at least one domain has both a URL and a read-only key configured. */
export function hostedReadModelsConfigured(env: Env): boolean {
  const ops = present(env, HOSTED_READ_MODEL_ENV.opsUrl) && present(env, HOSTED_READ_MODEL_ENV.opsKey);
  const fitness = present(env, HOSTED_READ_MODEL_ENV.fitnessUrl) && present(env, HOSTED_READ_MODEL_ENV.fitnessKey);
  return ops || fitness;
}

/**
 * Build the in-memory read-model registry for the hosted cockpit. Both domains
 * are always present and enabled; whether a domain goes LIVE is decided purely
 * by env presence downstream (resolveAvailability), exactly like the local path.
 */
export function buildHostedReadModelRegistry(): LoadedReadModelRegistry {
  const ops: ReadModelConfig = {
    id: "ops",
    type: "ops",
    enabled: true,
    mode: "supabase_readonly",
    supabaseUrlEnv: HOSTED_READ_MODEL_ENV.opsUrl,
    supabaseKeyEnv: HOSTED_READ_MODEL_ENV.opsKey,
    allowedTables: [],
    allowedRpcs: OPS_ALLOWED_RPCS,
    forbiddenOperations: [...FORBIDDEN_OPERATIONS],
  };
  const fitness: ReadModelConfig = {
    id: "fitness",
    type: "fitness",
    enabled: true,
    mode: "supabase_readonly",
    supabaseUrlEnv: HOSTED_READ_MODEL_ENV.fitnessUrl,
    supabaseKeyEnv: HOSTED_READ_MODEL_ENV.fitnessKey,
    allowedTables: [],
    allowedRpcs: FITNESS_ALLOWED_RPCS,
    forbiddenOperations: [...FORBIDDEN_OPERATIONS],
    rpcUserIdEnv: HOSTED_READ_MODEL_ENV.fitnessUserId,
    rpcAgentIdEnv: HOSTED_READ_MODEL_ENV.fitnessAgentId,
  };
  return { configPresent: true, configPath: null, readModels: [ops, fitness] };
}

function actionsInState(state: string): ActionId[] {
  return (Object.keys(ACTION_STATES) as ActionId[]).filter((a) => ACTION_STATES[a] === state).sort();
}

/** A non-misleading "no local agent config in hosted mode" integration summary. */
function hostedAgentIntegration(now: string): AgentIntegrationSummary {
  return {
    generatedAt: now,
    configPresent: false,
    configPath: null,
    configuredAgents: 0,
    detectedAgents: 0,
    agents: [],
    missingSources: [],
    nextRecommendedCommand: "Configure read-only Supabase read-models via Worker env (Phase 16D).",
  };
}

export interface ResolveHostedStateOptions {
  /** ISO "now". Defaults to a fresh Date at call time (Workers support Date). */
  now?: string;
  /**
   * Optional client factory passthrough (tests inject a fetch-stubbed client).
   * Defaults to the real read-only, service-role-refusing factory that uses the
   * Worker's global fetch.
   */
  clientFactory?: ClientFactory;
}

/**
 * Resolve a live, fs-free CockpitState from env. Returns null when no read-model
 * env is configured (the caller then serves the safe placeholder). Never throws
 * for a single-domain failure: that domain degrades and the rest still renders.
 */
export async function resolveHostedCockpitState(
  env: Env,
  options: ResolveHostedStateOptions = {}
): Promise<CockpitState | null> {
  if (!hostedReadModelsConfigured(env)) return null;

  const now = options.now ?? new Date().toISOString();
  const registry = buildHostedReadModelRegistry();

  // Live read (server-side, allowlisted, read-only). The summary builder only
  // performs a network read for a domain that is enabled AND has its env present.
  const readModels = await buildReadModelRegistrySummary({
    env,
    registry,
    ...(options.clientFactory ? { clientFactory: options.clientFactory } : {}),
  });

  const fitnessRm = readModels.summaries.find((s) => s.type === "fitness");
  const opsRm = readModels.summaries.find((s) => s.type === "ops");

  // Pure derivers — no I/O. Local report / handover layers are local-only and
  // simply absent in hosted mode, so the read-model layer is the only source.
  const sources: ResolvedSources = {
    fitness: deriveFitnessSource(fitnessRm, now),
    ops: deriveOpsSource(opsRm, now),
    factory: deriveFactorySource(),
  };

  let sourceDiagnostics: SourceDiagnosticsReport | undefined;
  try {
    sourceDiagnostics = await buildSourceDiagnostics({
      now,
      sources,
      env,
      registry,
      readModelSummaries: readModels.summaries,
    });
  } catch {
    sourceDiagnostics = undefined;
  }

  const agentIntegration = hostedAgentIntegration(now);
  const inputs: PanelInputs = {
    agentIntegration,
    readModels,
    reports: [],
    capability: { present: false, count: 0, byStatus: {}, names: [] },
    modules: DEFAULT_MODULES,
    now,
    sources,
  };
  const panels = buildDomainPanels(inputs);

  const groups: CockpitCardGroupView[] = (CARD_GROUPS as readonly CardGroup[]).map((group) => ({
    group,
    title: group,
    cards: [],
  }));

  return {
    generatedAt: now,
    mode: "hosted",
    title: "HartOS Command Center",
    summary: {
      cardCount: 0,
      groups: [...CARD_GROUPS],
      missingSourceCount: 0,
      readOnlyActionCount: actionsInState("read_only").length,
      approvalRequiredActionCount: actionsInState("approval_required").length,
      manualRequiredActionCount: actionsInState("manual_required").length,
      forbiddenActionCount: actionsInState("forbidden").length,
      reportCount: 0,
      latestRequest: null,
      latestStrategyVerdict: null,
      latestCtoVerdict: null,
      nextRecommendedCommand: "Ask HartOS for your Daily Command Brief.",
    },
    groups,
    cards: [],
    missingSources: [],
    readOnlyActions: actionsInState("read_only"),
    localReportActions: actionsInState("local_report_generation"),
    approvalRequiredActions: actionsInState("approval_required"),
    manualRequiredActions: actionsInState("manual_required"),
    forbiddenActions: actionsInState("forbidden"),
    reports: [],
    latestResponse: null,
    agentIntegration,
    readModels,
    panels,
    ...(sourceDiagnostics ? { sourceDiagnostics } : {}),
    // proposalQueue intentionally omitted — it is local-only in the hosted MVP,
    // so proposalsView reports the correct "local_only" status.
  };
}
