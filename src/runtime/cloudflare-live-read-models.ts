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
import { isServiceRoleKey } from "../cockpit/sources/secret-guard.js";
import { SupabaseReadClient, type FetchLike } from "../read-models/supabase-read-client.js";
import { buildFitnessDetail, buildOpsDetail, FITNESS_DETAIL_RPCS, type AgentDetail } from "../read-models/agent-detail.js";
import {
  findAgentDetailSpec,
  buildGenericAgentDetail,
  specAllowedRpcs,
  type AgentDetailSpec,
  type GenericAgentDetail,
} from "../read-models/agent-detail-registry.js";
import type { ActionProposal, ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
import {
  COCKPIT_PROPOSALS_RPC,
  coerceCockpitProposalRows,
  mapRowToProposalQueueItem,
  proposalToSpineRow,
} from "../cockpit/proposals/cockpit-proposal-spine.js";
import { containsSecret } from "../llm/redaction.js";
import {
  COCKPIT_THREADS_RPC,
  coerceCockpitThreadRows,
  mapRowToThreadSummary,
  type CockpitThreadSummary,
} from "../cockpit/threads/cockpit-thread-spine.js";
import {
  COCKPIT_PULSE_RUNS_RPC,
  coercePulseRunRows,
  mapRowToPulseRun,
  type PulseRun,
} from "../cockpit/pulse/pulse-run-spine.js";
import type { MemorySnapshot } from "../awareness/executive-memory.js";
import type { RinneganNote } from "../rinnegan/rinnegan-types.js";
import { COCKPIT_MEMORY_RPC, coerceCockpitMemoryRows } from "../awareness/cockpit-memory-spine.js";

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
  // Detail series (deployed + granted to anon in the fitness project).
  "get_fitness_bodyweight_series",
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
  /**
   * Phase D — inject the proposal-spine read (tests). When omitted, the live anon
   * RPC read runs ONLY if no clientFactory is injected (i.e. the real Worker
   * path); a stubbed read-model context therefore makes NO proposal network call.
   */
  proposalsProvider?: () => Promise<ProposalQueueItem[] | null>;
  /**
   * Step 2b — inject the executive-memory spine read (tests). When omitted, the live
   * anon RPC read runs ONLY if no clientFactory is injected (the real Worker path).
   */
  memoryProvider?: () => Promise<MemorySnapshot[] | null>;
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

  // Phase D — resolve the proposal queue from the Supabase spine. Tests inject a
  // provider; the real Worker path (no clientFactory) does the live anon read;
  // a stubbed read-model context with no provider makes NO proposal network call.
  let proposalQueue: ProposalQueueItem[] | null = null;
  if (options.proposalsProvider) {
    proposalQueue = await options.proposalsProvider().catch(() => null);
  } else if (!options.clientFactory) {
    proposalQueue = await resolveCockpitProposals(env, { now }).catch(() => null);
  }

  // Step 2b — resolve Executive Memory snapshots from the Supabase spine (anon RPC),
  // mirroring the proposal read. Tests inject a provider; the real Worker path does the
  // live anon read; a stubbed read-model context (clientFactory) makes NO memory call.
  let memorySnapshots: MemorySnapshot[] | null = null;
  if (options.memoryProvider) {
    memorySnapshots = await options.memoryProvider().catch(() => null);
  } else if (!options.clientFactory) {
    memorySnapshots = await resolveCockpitMemory(env, { now }).catch(() => null);
  }

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
    // Phase D — the proposal queue now comes from the Supabase spine (read-only,
    // anon RPC). Present (even empty) when the spine read succeeds; omitted on a
    // missing/failed read so proposalsView falls back to its honest local-only note.
    ...(proposalQueue ? { proposalQueue } : {}),
    // Step 2b — Executive Memory snapshots from the spine. Present only when the read
    // returned ≥1; omitted otherwise so the cockpit shows the honest INSUFFICIENT_HISTORY.
    ...(memorySnapshots && memorySnapshots.length ? { memorySnapshots } : {}),
    // Cockpit V2 mutation target resolution — individual ops cards (id · name · status) preserved
    // from get_ops_attention_cards, so a mutation instruction ("put this operation on hold") can
    // resolve to a real card. Absent when the ops read-model carried no attention cards.
    ...(opsRm?.attentionCards && opsRm.attentionCards.length ? { opsCards: opsRm.attentionCards } : {}),
  };
}

/**
 * Phase D — read the cockpit proposal spine LIVE from the fitness project via the
 * anon, read-only RPC. Same strict boundary as the read-models: anon key only
 * (service-role refused), sent as a header, never echoed. Returns the rows
 * (possibly empty) on success, or null when the fitness env is absent / a
 * service-role key is presented / the read fails — in which case proposalsView
 * falls back to its honest "local-only" note rather than fabricating an empty list.
 */
export async function resolveCockpitProposals(
  env: Env,
  options: { now?: string; fetchImpl?: FetchLike; limit?: number } = {},
): Promise<ProposalQueueItem[] | null> {
  const url = env[HOSTED_READ_MODEL_ENV.fitnessUrl];
  const key = env[HOSTED_READ_MODEL_ENV.fitnessKey];
  if (!url || !key || isServiceRoleKey(key)) return null;
  const client = new SupabaseReadClient(
    { url, key, allowedTables: [], allowedRpcs: [COCKPIT_PROPOSALS_RPC] },
    options.fetchImpl,
  );
  try {
    const body = await client.readRpc(COCKPIT_PROPOSALS_RPC, { p_limit: options.limit ?? 50 });
    return coerceCockpitProposalRows(body).map(mapRowToProposalQueueItem);
  } catch {
    return null;
  }
}

/**
 * Phase D — read the cockpit THREAD spine LIVE from the fitness project via the
 * anon, read-only RPC (mirrors resolveCockpitProposals). Anon key only
 * (service-role refused), sent as a header, never echoed. Returns the thread
 * summaries (possibly empty) on success, or null when the fitness env is absent /
 * a service-role key is presented / the read fails — in which case /api/threads
 * falls back to the (empty on hosted) local list rather than fabricating data.
 */
export async function resolveCockpitThreads(
  env: Env,
  options: { fetchImpl?: FetchLike; limit?: number } = {},
): Promise<CockpitThreadSummary[] | null> {
  const url = env[HOSTED_READ_MODEL_ENV.fitnessUrl];
  const key = env[HOSTED_READ_MODEL_ENV.fitnessKey];
  if (!url || !key || isServiceRoleKey(key)) return null;
  const client = new SupabaseReadClient(
    { url, key, allowedTables: [], allowedRpcs: [COCKPIT_THREADS_RPC] },
    options.fetchImpl,
  );
  try {
    const body = await client.readRpc(COCKPIT_THREADS_RPC, { p_limit: options.limit ?? 50 });
    return coerceCockpitThreadRows(body).map(mapRowToThreadSummary);
  } catch {
    return null;
  }
}

/**
 * Read recent autopilot PULSE RUNS LIVE from the fitness project via the anon, read-only RPC
 * (mirrors resolveCockpitThreads). Anon key only (service-role refused), sent as a header, never
 * echoed. Returns the runs newest-first (possibly empty) on success, or null when the fitness env
 * is absent / a service-role key is presented / the read fails — the cockpit then shows no
 * Last-Pulse tile rather than fabricating one.
 */
export async function resolveRecentPulseRuns(
  env: Env,
  options: { fetchImpl?: FetchLike; limit?: number } = {},
): Promise<PulseRun[] | null> {
  const url = env[HOSTED_READ_MODEL_ENV.fitnessUrl];
  const key = env[HOSTED_READ_MODEL_ENV.fitnessKey];
  if (!url || !key || isServiceRoleKey(key)) return null;
  const client = new SupabaseReadClient(
    { url, key, allowedTables: [], allowedRpcs: [COCKPIT_PULSE_RUNS_RPC] },
    options.fetchImpl,
  );
  try {
    const body = await client.readRpc(COCKPIT_PULSE_RUNS_RPC, { p_limit: options.limit ?? 14 });
    return coercePulseRunRows(body).map(mapRowToPulseRun);
  } catch {
    return null;
  }
}

/**
 * Step 2b — read the Executive Memory spine LIVE from the fitness project via the anon,
 * read-only RPC (mirrors resolveCockpitProposals). Anon key only (service-role refused),
 * sent as a header, never echoed. Returns the snapshots (possibly empty) on success, or
 * null when the fitness env is absent / a service-role key is presented / the read fails —
 * in which case the cockpit renders the honest INSUFFICIENT_HISTORY line.
 */
export async function resolveCockpitMemory(
  env: Env,
  options: { now?: string; fetchImpl?: FetchLike; limit?: number } = {},
): Promise<MemorySnapshot[] | null> {
  const url = env[HOSTED_READ_MODEL_ENV.fitnessUrl];
  const key = env[HOSTED_READ_MODEL_ENV.fitnessKey];
  if (!url || !key || isServiceRoleKey(key)) return null;
  const client = new SupabaseReadClient(
    { url, key, allowedTables: [], allowedRpcs: [COCKPIT_MEMORY_RPC] },
    options.fetchImpl,
  );
  try {
    const body = await client.readRpc(COCKPIT_MEMORY_RPC, { p_limit: options.limit ?? 120 });
    return coerceCockpitMemoryRows(body);
  } catch {
    return null;
  }
}

/** Rinnegan — the anon read RPC for the vault context pack (created by the 20260610100000 migration). */
export const COCKPIT_CONTEXT_PACK_RPC = "get_cockpit_context_pack";

/** Coerce context-pack rows → RinneganNote[] (body_excerpt becomes the note body). Defensive. */
function coerceContextPackRows(body: unknown): RinneganNote[] {
  const rows = Array.isArray(body) ? body : [];
  const out: RinneganNote[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.rel_path !== "string" || typeof o.title !== "string") continue;
    out.push({
      relPath: o.rel_path,
      title: o.title,
      tags: Array.isArray(o.tags) ? (o.tags as unknown[]).filter((t): t is string => typeof t === "string") : [],
      body: typeof o.body_excerpt === "string" ? o.body_excerpt : "",
      reviewBy: typeof o.review_by === "string" ? o.review_by : null,
      ageDays: typeof o.age_days === "number" ? o.age_days : null,
    });
  }
  return out;
}

/**
 * Rinnegan — read the context pack (the Obsidian vault mirror) LIVE from the fitness project via
 * the anon, read-only RPC. Same strict boundary as the other reads (anon only, service-role
 * refused). Returns the notes (possibly empty) on success, or null when env is absent / read fails.
 */
export async function resolveContextPack(
  env: Env,
  options: { fetchImpl?: FetchLike; limit?: number } = {},
): Promise<RinneganNote[] | null> {
  const url = env[HOSTED_READ_MODEL_ENV.fitnessUrl];
  const key = env[HOSTED_READ_MODEL_ENV.fitnessKey];
  if (!url || !key || isServiceRoleKey(key)) return null;
  const client = new SupabaseReadClient(
    { url, key, allowedTables: [], allowedRpcs: [COCKPIT_CONTEXT_PACK_RPC] },
    options.fetchImpl,
  );
  try {
    const body = await client.readRpc(COCKPIT_CONTEXT_PACK_RPC, { p_limit: options.limit ?? 400 });
    return coerceContextPackRows(body);
  } catch {
    return null;
  }
}

/**
 * Phase C — resolve one agent's DETAIL read-model LIVE from env, fs-free. Same
 * read-only anon boundary as the summaries (service-role keys refused). Returns
 * null when that domain's env isn't configured; the route then serves an honest
 * "unavailable" payload. The fitness detail allowlist adds the U-F5 bodyweight
 * series RPC on top of the summary allowlist.
 */
export async function resolveAgentDetail(
  env: Env,
  domain: string,
  options: { now?: string; fetchImpl?: FetchLike } = {},
): Promise<AgentDetail | GenericAgentDetail | null> {
  const now = options.now ?? new Date().toISOString();
  if (domain === "fitness") {
    const url = env[HOSTED_READ_MODEL_ENV.fitnessUrl];
    const key = env[HOSTED_READ_MODEL_ENV.fitnessKey];
    const userId = env[HOSTED_READ_MODEL_ENV.fitnessUserId];
    const agentId = env[HOSTED_READ_MODEL_ENV.fitnessAgentId];
    if (!url || !key || !userId || !agentId || isServiceRoleKey(key)) return null;
    const client = new SupabaseReadClient(
      { url, key, allowedTables: [], allowedRpcs: [...FITNESS_ALLOWED_RPCS, FITNESS_DETAIL_RPCS.bodyweightSeries] },
      options.fetchImpl,
    );
    return buildFitnessDetail(client, { userId, agentId }, { now });
  }
  if (domain === "ops") {
    const url = env[HOSTED_READ_MODEL_ENV.opsUrl];
    const key = env[HOSTED_READ_MODEL_ENV.opsKey];
    if (!url || !key || isServiceRoleKey(key)) return null;
    const client = new SupabaseReadClient({ url, key, allowedTables: [], allowedRpcs: OPS_ALLOWED_RPCS }, options.fetchImpl);
    return buildOpsDetail(client, { now });
  }
  // Phase C / Gap C — any agent that DECLARED a generic detail spec renders with
  // no bespoke code. Unknown domains resolve to null (route → honest unavailable).
  const spec = findAgentDetailSpec(domain);
  if (spec) return resolveGenericAgentDetail(env, spec, { now, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
  return null;
}

/** Resolve a registered (generic) agent's detail from env — same anon, read-only boundary. */
async function resolveGenericAgentDetail(
  env: Env,
  spec: AgentDetailSpec,
  options: { now: string; fetchImpl?: FetchLike },
): Promise<GenericAgentDetail | null> {
  const url = env[spec.urlEnv];
  const key = env[spec.keyEnv];
  if (!url || !key || isServiceRoleKey(key)) return null;
  const baseArgs: Record<string, unknown> = {};
  if (spec.userIdEnv && env[spec.userIdEnv]) baseArgs.p_user_id = env[spec.userIdEnv];
  if (spec.agentIdEnv && env[spec.agentIdEnv]) baseArgs.p_agent_id = env[spec.agentIdEnv];
  const client = new SupabaseReadClient({ url, key, allowedTables: [], allowedRpcs: specAllowedRpcs(spec) }, options.fetchImpl);
  return buildGenericAgentDetail(client, spec, baseArgs, { now: options.now });
}

// ─── Phase E (Gap E) — Ask HartOS → spine WRITE (Worker side; no DB key) ──────

/** Env var NAMES for the gated Ask write path (the Worker holds only a token). */
export const ASK_WRITE_ENV = {
  url: "HARTOS_ASK_WRITE_URL",
  token: "HARTOS_ASK_WRITE_TOKEN",
} as const;

export interface ProposalPersistResult {
  attempted: boolean;
  persisted: number;
  failed: number;
  reason: string;
}

/** Minimal fetch surface the writer needs (tests inject a stub). */
export type WriteFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Persist generated (non-executable) proposal drafts into the cockpit spine by
 * calling the gated Edge Function. The Worker stays read-only: it holds NO
 * service-role / DB credential — only a shared CAPABILITY token, sent as a bearer
 * to the one allowlisted function. Best-effort + fail-safe: it never throws and
 * never blocks the Ask answer. When the write env is absent the Ask stays
 * advisory (attempted:false) — the read-only default posture. A content-stable id
 * (proposalToSpineRow) makes re-asking the same outcome idempotent.
 */
export async function persistCockpitProposals(
  env: Env,
  proposals: ActionProposal[],
  options: { now?: string; sourceIntent?: string; fetchImpl?: WriteFetch } = {},
): Promise<ProposalPersistResult> {
  const url = env[ASK_WRITE_ENV.url];
  const token = env[ASK_WRITE_ENV.token];
  if (!url || !token) return { attempted: false, persisted: 0, failed: 0, reason: "write endpoint not configured (advisory-only)" };
  if (!proposals.length) return { attempted: false, persisted: 0, failed: 0, reason: "no proposals to persist" };

  const now = options.now ?? new Date().toISOString();
  const rows = proposals.map((p) =>
    proposalToSpineRow(p, options.sourceIntent ? { now, sourceIntent: options.sourceIntent } : { now }),
  );
  // Defense in depth — refuse to SEND anything secret-looking (the function scans too).
  if (containsSecret(JSON.stringify(rows))) {
    return { attempted: true, persisted: 0, failed: rows.length, reason: "secret-looking content refused before send" };
  }
  const doFetch = options.fetchImpl ?? (globalThis.fetch as unknown as WriteFetch);
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ proposals: rows }),
    });
    if (!res.ok) return { attempted: true, persisted: 0, failed: rows.length, reason: `write endpoint returned ${res.status}` };
    const body = (await res.json().catch(() => ({}))) as { persisted?: number; failed?: number };
    const persisted = typeof body.persisted === "number" ? body.persisted : rows.length;
    const failed = typeof body.failed === "number" ? body.failed : 0;
    return { attempted: true, persisted, failed, reason: "ok" };
  } catch {
    return { attempted: true, persisted: 0, failed: rows.length, reason: "write endpoint unreachable" };
  }
}

// ─── Phase 2.4 — Approval transitions (Worker side; still no DB key) ───────────

export type CockpitTransitionAction = "approve" | "reject";

export interface ProposalTransitionResult {
  attempted: boolean;
  ok: boolean;
  /** Resulting status reported by the Edge Function, or null on a no-op/failure. */
  status: string | null;
  reason: string;
}

/**
 * Approve/reject a proposal via the SAME gated Edge Function. The Worker still holds NO
 * service-role/DB key — only the shared CAPABILITY token. The Edge Function performs a
 * CONDITIONAL, status-safe write (approve only acts on a pending_approval row; reject only
 * on an active row; it never downgrades) and appends an audit event. Best-effort +
 * fail-safe: it never throws. The approval target is `simulated_approved` — authorizing
 * real EXECUTION (`approved_for_execution`) is a separate, more deliberate step (Phase 3).
 */
export async function transitionCockpitProposal(
  env: Env,
  input: { id: string; action: CockpitTransitionAction },
  options: { fetchImpl?: WriteFetch } = {},
): Promise<ProposalTransitionResult> {
  const url = env[ASK_WRITE_ENV.url];
  const token = env[ASK_WRITE_ENV.token];
  if (!url || !token) return { attempted: false, ok: false, status: null, reason: "write endpoint not configured (advisory-only)" };
  if (!input.id || (input.action !== "approve" && input.action !== "reject")) {
    return { attempted: false, ok: false, status: null, reason: "invalid transition request" };
  }
  const doFetch = options.fetchImpl ?? (globalThis.fetch as unknown as WriteFetch);
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ transition: { id: input.id, action: input.action } }),
    });
    if (!res.ok) return { attempted: true, ok: false, status: null, reason: `transition endpoint returned ${res.status}` };
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string };
    return {
      attempted: true,
      ok: body.ok === true,
      status: typeof body.status === "string" ? body.status : null,
      reason: body.ok === true ? "ok" : "no-op (proposal not in an eligible status)",
    };
  } catch {
    return { attempted: true, ok: false, status: null, reason: "transition endpoint unreachable" };
  }
}
