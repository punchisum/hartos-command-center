/**
 * src/runtime/cloudflare-cockpit-views.ts
 *
 * Phase 16 — shared, PURE read-only view builders for the hosted cockpit. Both
 * the Worker API routes and the hosted HTML page use these so the JSON the API
 * returns and the HTML the page renders are derived from the SAME logic.
 *
 * Everything here is read-only and deterministic: it derives views from a
 * pre-built CockpitState snapshot (built in Node at deploy/dry-run time). No
 * filesystem, no network, no mutation, no execution.
 */

import type { CockpitState } from "../cockpit/cockpit-types.js";
import { routeCockpitIntent, type CockpitIntentResult, type IntentRouterContext, type IntentOrchestratorContext } from "../cockpit/cockpit-intent-router.js";
import { buildFreshnessReport, type FreshnessReport } from "../cockpit/freshness-surface.js";
import type { ProposalQueueItem } from "../cockpit/proposals/index.js";
import { buildHostedOrchestratorContext } from "../cockpit/hosted-cto-context.js";
import { fleetSignals, renderFleetView, type FleetSignal } from "../read-models/agent-signal.js";
import { perceive, type PerceptionReport } from "../rinnegan/perception.js";
import { collectFleetTasks } from "../fleet/fleet-work.js";
import { orchestrateFleet, type FleetPlan } from "../fleet/orchestrator.js";
import { forecast, type ForecastReport } from "../prophet/forecast.js";
import {
  suggestActions,
  type SuggestionSet,
  type SuggestedAction,
  type SuggestionPriority,
  type SuggestionSource,
} from "../cockpit/suggestions/suggest-actions.js";
import { synthesizeFleet } from "../fleet/fleet-synthesis.js";
import { suggestionsFromSynthesis } from "../cockpit/suggestions/synthesis-suggestions.js";

/** Build a read-only intent-router context from a cockpit snapshot. */
export function hostedIntentContext(
  state: CockpitState | undefined,
  request: string,
  now?: string
): IntentRouterContext {
  const panels = state?.panels ?? [];
  return {
    request,
    panels,
    systemSummary:
      state?.summary ?? {
        cardCount: 0,
        groups: [],
        missingSourceCount: 0,
        readOnlyActionCount: 0,
        approvalRequiredActionCount: 0,
        manualRequiredActionCount: 0,
        forbiddenActionCount: 0,
        reportCount: 0,
        latestRequest: null,
        latestStrategyVerdict: null,
        latestCtoVerdict: null,
        nextRecommendedCommand: "npm run cockpit:snapshot",
      },
    integration: {
      configPresent: state?.agentIntegration?.configPresent ?? false,
      agentsConfigured: state?.agentIntegration?.configuredAgents ?? 0,
      agentsDetected: state?.agentIntegration?.detectedAgents ?? 0,
      readModelsEnabled: state?.readModels?.enabledReadModels ?? 0,
    },
    llm: { provider: "deterministic", mode: "fallback" },
    ...(now ? { now } : {}),
    ...(state?.sourceDiagnostics ? { diagnostics: state.sourceDiagnostics } : {}),
    proposalQueue: state?.proposalQueue ?? [],
    // Phase E — the deterministic CTO input brain. Attached ONLY for
    // build/strategy requests; undefined for status queries (which are left
    // exactly as before, including the zero-proposals guarantee).
    ...((): { orchestrator?: IntentOrchestratorContext } => {
      const orchestrator = buildHostedOrchestratorContext(request);
      return orchestrator ? { orchestrator } : {};
    })(),
  };
}

/**
 * Route an Ask HartOS request against the snapshot, deterministically.
 * When `now` is provided, explicit proposal/plan language yields non-persisted
 * dry-run proposal drafts; status/brief/freshness questions yield zero.
 */
export function routeHosted(state: CockpitState | undefined, request: string, now?: string): CockpitIntentResult {
  return routeCockpitIntent(hostedIntentContext(state, request, now));
}

/** Build the freshness report from the snapshot panels + diagnostics. */
export function freshnessView(state: CockpitState | undefined, now: string): FreshnessReport | null {
  const panels = state?.panels;
  if (!panels || panels.length === 0) return null;
  return buildFreshnessReport({
    panels,
    now,
    ...(state?.sourceDiagnostics ? { diagnostics: state.sourceDiagnostics } : {}),
  });
}

export interface ReadModelStatusView {
  available: boolean;
  note: string;
  generatedAt: string | null;
  configPresent: boolean;
  configuredSources: string[];
  enabledSources: string[];
  staleSources: string[];
  rejectedSources: string[];
  missingSources: string[];
  domains: { domain: string; status: string; resolvedFields: number; freshness: string; note: string }[];
}

/** Safe read-model status view (presence/status only — never secrets/values). */
export function readModelStatusView(state: CockpitState | undefined): ReadModelStatusView {
  const d = state?.sourceDiagnostics;
  if (!d) {
    return {
      available: false,
      note: "Read-model diagnostics are not embedded in this snapshot. Run `npm run read-models:status` locally, then re-bake the snapshot.",
      generatedAt: null,
      configPresent: false,
      configuredSources: [],
      enabledSources: [],
      staleSources: [],
      rejectedSources: [],
      missingSources: [],
      domains: [],
    };
  }
  return {
    available: true,
    note: "Read-only status; resolved from the baked snapshot. No secrets or values are exposed.",
    generatedAt: d.generatedAt,
    configPresent: d.configPresent,
    configuredSources: d.configuredSources,
    enabledSources: d.enabledSources,
    staleSources: d.staleSources,
    rejectedSources: d.rejectedSources,
    missingSources: d.missingSources,
    domains: d.domains.map((x) => ({
      domain: x.domain,
      status: x.status,
      resolvedFields: x.resolvedFields,
      freshness: x.freshness,
      note: x.note,
    })),
  };
}

export interface ProposalsView {
  available: boolean;
  mode: "read_only_snapshot" | "local_only";
  origin: "local";
  executable: "disabled";
  note: string;
  total: number;
  pending: number;
  /** Derived hygiene counts (view-only; no durable write — run the hygiene command to apply). */
  duplicates: number;
  staleExpired: number;
  proposals: {
    n: number;
    id: string;
    domain: string;
    riskLevel: string;
    title: string;
    status: string;
    /** One-line plain-English effect, lifted from the proposal's expectedEffect/description. */
    effect: string;
    /** Why a reasonable operator might approve — derived from effect + risk. */
    whyApprove: string;
    /** Why a reasonable operator might reject / hold — derived from risk + hygiene flags. */
    whyReject: string;
    /** This proposal duplicates an active newer one (same domain+actionType+title). */
    duplicate: boolean;
    /** Past its expiresAt while still draft/pending — should be expired by the hygiene command. */
    staleExpired: boolean;
    executable: false;
  }[];
}

/** Pure, view-only hygiene + reasoning derivation (no writes; mirrors the explicit-command rules). */
function deriveProposalHygiene(
  queue: ProposalQueueItem[],
  now: string,
): Map<string, { duplicate: boolean; staleExpired: boolean }> {
  const ACTIVE = new Set(["draft", "pending_approval"]);
  const out = new Map<string, { duplicate: boolean; staleExpired: boolean }>();
  // Duplicate = same domain|actionType|title among ACTIVE; keep newest (queue is newest-first),
  // flag the rest. Mirrors expireDuplicateProposals without writing.
  const seenKey = new Set<string>();
  const nowMs = Date.parse(now);
  for (const p of queue) {
    const active = ACTIVE.has(p.status);
    const key = `${p.domain}|${p.actionType}|${p.title}`;
    let duplicate = false;
    if (active) {
      if (seenKey.has(key)) duplicate = true;
      else seenKey.add(key);
    }
    const staleExpired =
      active && !!p.expiresAt && !Number.isNaN(nowMs) && Date.parse(p.expiresAt) < nowMs;
    out.set(p.id, { duplicate, staleExpired });
  }
  return out;
}

/** Plain-English "why approve / why reject" for a proposal (deterministic, no LLM). */
function proposalReasoning(
  p: ProposalQueueItem,
  flags: { duplicate: boolean; staleExpired: boolean },
): { effect: string; whyApprove: string; whyReject: string } {
  const effect = (p.expectedEffect || p.description || "Effect not described.").trim();
  const whyApprove =
    `Advances "${p.title}" (${p.domain}). ${effect} Dry-run only — approval just clears it for a future gated, audited step; nothing executes now.`;
  const rejectBits: string[] = [];
  if (flags.staleExpired) rejectBits.push("past its expiry window (likely no longer relevant)");
  if (flags.duplicate) rejectBits.push("duplicates a newer proposal already in the queue");
  if (p.riskLevel === "high") rejectBits.push("high risk — confirm the target and rollback note first");
  const whyReject = rejectBits.length
    ? `Hold/reject: ${rejectBits.join("; ")}.`
    : "Reject if the effect above isn't what you want, or you'd rather act manually.";
  return { effect, whyApprove, whyReject };
}

/** Compact, read-only view of the local proposal queue (non-executable). */
export function proposalsView(state: CockpitState | undefined, now = ""): ProposalsView {
  const queue: ProposalQueueItem[] | undefined = state?.proposalQueue;
  if (!queue) {
    return {
      available: false,
      mode: "local_only",
      origin: "local",
      executable: "disabled",
      note: "Proposal queue is local-only in the hosted MVP. Create/manage proposals from the local cockpit (npm run cockpit:web).",
      total: 0,
      pending: 0,
      duplicates: 0,
      staleExpired: 0,
      proposals: [],
    };
  }
  const resolvedNow = now || state?.generatedAt || "";
  const hygiene = deriveProposalHygiene(queue, resolvedNow);
  const pending = queue.filter((p) => p.status === "draft" || p.status === "pending_approval").length;
  let duplicates = 0;
  let staleExpired = 0;
  for (const f of hygiene.values()) {
    if (f.duplicate) duplicates += 1;
    if (f.staleExpired) staleExpired += 1;
  }
  return {
    available: true,
    mode: "read_only_snapshot",
    origin: "local",
    executable: "disabled",
    note: "Read-only snapshot of the local proposal queue. All proposals are dry-run only and cannot be executed from the hosted cockpit.",
    total: queue.length,
    pending,
    duplicates,
    staleExpired,
    proposals: queue.slice(0, 20).map((p, i) => {
      const flags = hygiene.get(p.id) ?? { duplicate: false, staleExpired: false };
      const reasoning = proposalReasoning(p, flags);
      return {
        n: i + 1,
        id: p.id,
        domain: p.domain,
        riskLevel: p.riskLevel,
        title: p.title,
        status: p.status,
        effect: reasoning.effect,
        whyApprove: reasoning.whyApprove,
        whyReject: reasoning.whyReject,
        duplicate: flags.duplicate,
        staleExpired: flags.staleExpired,
        executable: false as const,
      };
    }),
  };
}

export interface FleetView {
  available: boolean;
  note: string;
  generatedAt: string | null;
  /** One unified AgentSignal per agent (verdict·confidence·freshness·nextAction·approval). */
  agents: FleetSignal[];
  /** The unified text render — identical for the HTML page and the JSON API. */
  rendered: string;
}

/**
 * Workstream C wiring — the unified cross-agent fleet view. Maps EVERY agent's
 * read-model summary (built by the live registry in resolveHostedCockpitState)
 * onto the shared AgentSignal and renders them identically, with no bespoke
 * per-agent glue. Derived purely from the snapshot's read-model summaries:
 * read-only, no I/O, no mutation. confidence/freshness are honest from the data
 * (see src/read-models/agent-signal.ts); a missing domain still appears, mapped
 * to unknown — never fabricated.
 */
export function fleetView(state: CockpitState | undefined, now: string): FleetView {
  const summaries = state?.readModels?.summaries ?? [];
  // Honest "now": only feed a parseable timestamp to freshness derivation; an
  // empty/invalid snapshot time falls back to the agent-signal default.
  const parsed = now ? new Date(now) : null;
  const opts = parsed && !Number.isNaN(parsed.getTime()) ? { now: parsed } : {};
  const agents = fleetSignals([...summaries], opts);
  const rendered = renderFleetView(agents);
  if (summaries.length === 0) {
    return {
      available: false,
      note: "Fleet view is unavailable (no live read-model summaries resolved). Configure the Fitness/Ops read-model env on the Worker.",
      generatedAt: state?.generatedAt ?? null,
      agents,
      rendered,
    };
  }
  return {
    available: true,
    note: "Read-only unified fleet view. Each agent is mapped onto the shared AgentSignal; nothing is fabricated.",
    generatedAt: state?.generatedAt ?? null,
    agents,
    rendered,
  };
}

/**
 * The cross-system "Suggested actions" synthesis for a snapshot. Shared by the landing
 * page (to render the panel) and the persist route (to write drafts) so the two never
 * diverge. It also folds in the per-agent headline calls (fitness coach + ops triage,
 * read from the panels' `advisory`) so "do next" includes them, not just the
 * cross-system items. Pure.
 *
 * `pre` lets a caller that already computed perception/plan/forecast (the landing page)
 * pass them in, so the page doesn't run the whole pipeline twice per render. The persist
 * route omits `pre` and computes fresh.
 *
 * It ALSO folds in the CROSS-AGENT synthesis suggestions (`suggestionsFromSynthesis` over the
 * `synthesizeFleet` rollup of the SAME perception+forecast it already has) — the multi-source
 * risks a single-source `suggestActions` pass cannot see. Those synthesis actions are merged
 * BEFORE the dedup+rank pass, so they are deduped-by-normalized-title against the single-source
 * suggestions (a synthesis restatement of an existing item collapses — desired) and dropped if
 * already in the persisted queue, while their distinct `sx-syn-` ids prevent any proposal-layer
 * collision. The merge reuses the EXACT dedup/rank/cap logic `suggestActions` applies, so the
 * panel and the persist route see one consistent ranking. The floor never moves: every surfaced
 * action stays a non-executable proposal candidate (it maps through `suggestionToProposal` →
 * `executable:false`, `requiredApproval:"Hart"`, `status:"draft"`). §19: the synthesis confidence
 * is already weakest-clamped by `synthesizeFleet`; we SURFACE it (in the rationale) and never
 * re-derive or inflate it. PURE — `synthesizeFleet` + `suggestionsFromSynthesis` are Worker-safe.
 */
export function cockpitSuggestions(
  state: CockpitState | undefined,
  now: string,
  pre?: { perception?: PerceptionReport; plan?: FleetPlan; forecast?: ForecastReport },
): SuggestionSet {
  let perception = pre?.perception;
  if (!perception) {
    const fr = freshnessView(state, now);
    const rms = readModelStatusView(state);
    const fleet = fleetView(state, now);
    perception = perceive({ now, freshness: fr, proposals: state?.proposalQueue ?? [], missingSources: rms.missingSources, fleetSignals: fleet.agents });
  }
  const plan = pre?.plan ?? orchestrateFleet(collectFleetTasks({ perception }));
  const fcast = pre?.forecast ?? forecast({ now, perception, plan, proposals: state?.proposalQueue ?? [] });

  // Fold in the per-agent headline calls from the panels' advisory (only when they
  // call for a change), so the fitness coach + ops triage reach the "do next" list.
  const panels = state?.panels ?? [];
  const fitnessAdv = panels.find((p) => p.id === "fitness")?.advisory;
  const opsAdv = panels.find((p) => p.id === "ops")?.advisory;
  const coach = fitnessAdv?.act ? { headline: fitnessAdv.headline, priority: fitnessAdv.priority, act: true } : null;
  const triage = opsAdv?.act ? { action: opsAdv.headline, priority: opsAdv.priority, act: true } : null;

  const existingTitles = (state?.proposalQueue ?? []).map((p) => p.title);

  // The single-source "do next" list — already deduped, ranked, and queue-aware. We request a
  // HIGH base limit (not the default 6) so the base is NOT pre-truncated before the synthesis
  // fold: the cross-agent actions must compete against the FULL single-source set, then the real
  // cap of 6 is applied once in `mergeSuggestions` (i.e. the cap rides AFTER the merge, so a
  // high-priority synthesis item can never be crowded out by a base item only kept by the cap).
  const base = suggestActions({
    perception,
    forecast: fcast,
    plan,
    coach,
    triage,
    existingTitles,
    limit: Number.MAX_SAFE_INTEGER,
  });

  // CROSS-AGENT fold: synthesize the SAME perception+forecast (briefing omitted) into the
  // correlated-risk rollup and map its MULTI-SOURCE risks to SuggestedActions. These are net-new
  // (a single-source pass can't see them); their distinct `sx-syn-` ids never collide with the
  // `sg-` scheme. We merge them into the base list through the SAME dedup-by-title + rank + cap
  // pass `suggestActions` uses, so a synthesis restatement of an existing suggestion collapses,
  // an already-queued title is dropped, and the established ranking is preserved.
  const synthesis = synthesizeFleet({ perception, forecast: fcast });
  const synthActions = suggestionsFromSynthesis(synthesis);

  // Fold the (possibly empty) synthesis set in through the SAME dedup/rank/cap — this also applies
  // the real cap of 6 to the high-limit base set above. Identical to suggestActions when empty.
  return mergeSuggestions(base, synthActions, existingTitles);
}

// ─── Merge fold: re-applies suggest-actions.ts's EXACT dedup/rank/cap to a union of actions ──
//
// These mirror the (module-private) constants in suggest-actions.ts so the fold preserves the
// identical ranking + dedup the single-source pass uses — synthesis actions are NOT privileged.
const SUGGESTION_PRIORITY_RANK: Record<SuggestionPriority, number> = { high: 3, medium: 2, low: 1 };
const SUGGESTION_SOURCE_WEIGHT: Record<SuggestionSource, number> = {
  orchestrator: 5,
  forecast: 4,
  perception: 3,
  triage: 2,
  coach: 1,
};
/** Normalized title key — byte-for-byte the suggest-actions.ts `norm`, so dedup agrees. */
function normSuggestionTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Fold `extra` (the synthesis suggestions) into the already-ranked `base` set, applying the SAME
 * title-dedup + priority/source rank + cap suggest-actions.ts uses. Deterministic, propose-only:
 * it neither writes nor mutates any action — it only selects/orders existing candidates. A title
 * already in the persisted queue is dropped (queue-safe); a synthesis restatement of an existing
 * suggestion collapses to the higher-priority (then higher-source-weight) version.
 */
function mergeSuggestions(
  base: SuggestionSet,
  extra: SuggestedAction[],
  existingTitles: string[],
  limit = 6,
): SuggestionSet {
  const seen = new Set(existingTitles.map(normSuggestionTitle));
  const byKey = new Map<string, SuggestedAction>();
  const add = (a: SuggestedAction): void => {
    const key = normSuggestionTitle(a.title);
    if (seen.has(key)) return; // already decided in the persisted queue — never re-suggest
    const prev = byKey.get(key);
    if (
      !prev ||
      SUGGESTION_PRIORITY_RANK[a.priority] > SUGGESTION_PRIORITY_RANK[prev.priority] ||
      (SUGGESTION_PRIORITY_RANK[a.priority] === SUGGESTION_PRIORITY_RANK[prev.priority] &&
        SUGGESTION_SOURCE_WEIGHT[a.source] > SUGGESTION_SOURCE_WEIGHT[prev.source])
    ) {
      byKey.set(key, a);
    }
  };
  // `base.actions` is already deduped against the queue + itself; folding the synthesis actions
  // through the same `add` collapses any title restatement and respects the queue.
  for (const a of base.actions) add(a);
  for (const a of extra) add(a);

  const actions = [...byKey.values()]
    .sort(
      (a, b) =>
        SUGGESTION_PRIORITY_RANK[b.priority] - SUGGESTION_PRIORITY_RANK[a.priority] ||
        SUGGESTION_SOURCE_WEIGHT[b.source] - SUGGESTION_SOURCE_WEIGHT[a.source] ||
        (a.title < b.title ? -1 : 1),
    )
    .slice(0, limit);

  const note = actions.length
    ? `${actions.length} suggested action(s) synthesized from the live intelligence — propose-only, nothing is auto-executed.`
    : "No actions to suggest — the live intelligence is clear, or everything actionable is already in the queue.";

  return { actions, note };
}
