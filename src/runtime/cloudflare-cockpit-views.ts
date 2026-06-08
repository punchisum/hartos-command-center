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
import { suggestActions, type SuggestionSet } from "../cockpit/suggestions/suggest-actions.js";

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
  proposals: {
    n: number;
    id: string;
    domain: string;
    riskLevel: string;
    title: string;
    status: string;
    executable: false;
  }[];
}

/** Compact, read-only view of the local proposal queue (non-executable). */
export function proposalsView(state: CockpitState | undefined): ProposalsView {
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
      proposals: [],
    };
  }
  const pending = queue.filter((p) => p.status === "draft" || p.status === "pending_approval").length;
  return {
    available: true,
    mode: "read_only_snapshot",
    origin: "local",
    executable: "disabled",
    note: "Read-only snapshot of the local proposal queue. All proposals are dry-run only and cannot be executed from the hosted cockpit.",
    total: queue.length,
    pending,
    proposals: queue.slice(0, 20).map((p, i) => ({
      n: i + 1,
      id: p.id,
      domain: p.domain,
      riskLevel: p.riskLevel,
      title: p.title,
      status: p.status,
      executable: false as const,
    })),
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

  return suggestActions({
    perception,
    forecast: fcast,
    plan,
    coach,
    triage,
    existingTitles: (state?.proposalQueue ?? []).map((p) => p.title),
  });
}
