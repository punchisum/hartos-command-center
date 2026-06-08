/**
 * src/cockpit/suggestions/suggest-actions.ts
 *
 * "Close the loop" — the deterministic SYNTHESIS layer that turns the cockpit's
 * separate intelligence modules (Prophet forecast, Fleet orchestrator, Rinnegan
 * perception, the fitness coach, the ops triage) into ONE ranked, de-duplicated
 * "what should I actually do next" list. Every other panel describes a slice of
 * state; this is the single actionable distillation across all of them.
 *
 * Each suggestion is shaped as a real cockpit proposal candidate (domain +
 * actionType from the proposal contract) so it can later be persisted to the Gap E
 * spine for approval — but this module itself is PURE and read-only: it neither
 * writes nor executes. It is the propose half of propose-only; approval stays Hart's.
 * Suggestions already present in the persisted queue are dropped (no re-suggesting a
 * decided item), and the list is capped so it stays a focused "do next", not a dump.
 */

import type { PerceptionReport } from "../../rinnegan/perception.js";
import type { ForecastReport } from "../../prophet/forecast.js";
import type { FleetPlan } from "../../fleet/orchestrator.js";
import type { ProposalDomain, ProposalActionType } from "../proposals/proposal-types.js";

export type SuggestionPriority = "high" | "medium" | "low";
export type SuggestionSource = "forecast" | "orchestrator" | "perception" | "coach" | "triage";

export interface SuggestedAction {
  /** Content-stable id (source + normalized title) — so it never duplicates across bakes. */
  id: string;
  domain: ProposalDomain;
  actionType: ProposalActionType;
  /** The action to take. */
  title: string;
  /** Why — grounded in the module's evidence, never fabricated. */
  rationale: string;
  source: SuggestionSource;
  priority: SuggestionPriority;
}

export interface SuggestionSet {
  /** Ranked (priority, then source weight), de-duplicated, capped. */
  actions: SuggestedAction[];
  /** Honest one-line summary. */
  note: string;
}

export interface SuggestInput {
  perception?: PerceptionReport | null;
  forecast?: ForecastReport | null;
  plan?: FleetPlan | null;
  /** The fitness coach's headline + priority, extracted from the panel (optional). */
  coach?: { headline: string; priority: SuggestionPriority; act: boolean } | null;
  /** The ops triage primary action + priority, extracted from the panel (optional). */
  triage?: { action: string; priority: SuggestionPriority; act: boolean } | null;
  /** Titles already in the persisted proposal queue — dropped from suggestions. */
  existingTitles?: string[];
  /** Max suggestions to surface (default 6). */
  limit?: number;
}

const PRIORITY_RANK: Record<SuggestionPriority, number> = { high: 3, medium: 2, low: 1 };
const SOURCE_WEIGHT: Record<SuggestionSource, number> = { orchestrator: 5, forecast: 4, perception: 3, triage: 2, coach: 1 };

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function slug(s: string): string {
  return norm(s).replace(/\s+/g, "-").slice(0, 60) || "x";
}
function actionId(source: string, title: string): string {
  return `sg-${slug(source)}-${slug(title)}`.slice(0, 90);
}

/**
 * Synthesize the live intelligence into a ranked, de-duplicated action list.
 * Deterministic: same input → same suggestions.
 */
export function suggestActions(input: SuggestInput): SuggestionSet {
  const limit = input.limit ?? 6;
  const seen = new Set((input.existingTitles ?? []).map(norm));
  const byKey = new Map<string, SuggestedAction>();

  const add = (a: SuggestedAction): void => {
    const key = norm(a.title);
    if (seen.has(key)) return; // already in the persisted queue — don't re-suggest
    const prev = byKey.get(key);
    // Keep the higher-priority (then higher-source-weight) version of a duplicate.
    if (!prev || PRIORITY_RANK[a.priority] > PRIORITY_RANK[prev.priority] ||
      (PRIORITY_RANK[a.priority] === PRIORITY_RANK[prev.priority] && SOURCE_WEIGHT[a.source] > SOURCE_WEIGHT[prev.source])) {
      byKey.set(key, a);
    }
  };

  // ── Orchestrator deferrals → the most structural asks (build / scale) ──
  if (input.plan) {
    for (const d of input.plan.deferred) {
      if (d.reason === "capability_gap") {
        const title = `Build an agent for "${d.task.targetCapability}" work`;
        add({ id: actionId("orchestrator", title), domain: "system", actionType: "build_agent_plan", title, rationale: d.detail, source: "orchestrator", priority: "high" });
      }
    }
  }

  // ── Forecast → prevent the highest-impact consequences of inaction ──
  if (input.forecast) {
    for (const c of input.forecast.consequences) {
      if (c.severity === "low") continue;
      const domain: ProposalDomain = c.subject.includes("fleet") ? "system" : c.subject === "fitness" ? "fitness" : c.subject === "proposals" ? "system" : "ops";
      const actionType: ProposalActionType = c.subject.includes("capability") ? "build_agent_plan" : domain === "fitness" ? "fitness_adjustment_plan" : "sync_repair_plan";
      add({ id: actionId("forecast", c.preventedBy), domain, actionType, title: c.preventedBy, rationale: c.projection, source: "forecast", priority: c.severity === "high" ? "high" : "medium" });
    }
  }

  // ── Perception → fix what's wrong now (critical/warn) ──
  if (input.perception) {
    for (const o of input.perception.observations) {
      if (o.severity === "info") continue;
      const domain: ProposalDomain = o.subject === "fitness" ? "fitness" : o.subject === "clickup" || o.subject === "ops" ? "ops" : "system";
      add({ id: actionId("perception", o.recommendation), domain, actionType: "sync_repair_plan", title: o.recommendation, rationale: o.detail, source: "perception", priority: o.severity === "critical" ? "high" : "medium" });
    }
  }

  // ── Ops triage → the top operational action ──
  if (input.triage?.act) {
    add({ id: actionId("triage", input.triage.action), domain: "ops", actionType: "ops_followup_plan", title: input.triage.action, rationale: "From the ops triage queue.", source: "triage", priority: input.triage.priority });
  }

  // ── Coach → today's training call (only when it needs a change) ──
  if (input.coach?.act) {
    add({ id: actionId("coach", input.coach.headline), domain: "fitness", actionType: "fitness_adjustment_plan", title: input.coach.headline, rationale: "From the fitness coach.", source: "coach", priority: input.coach.priority });
  }

  const actions = [...byKey.values()].sort(
    (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || SOURCE_WEIGHT[b.source] - SOURCE_WEIGHT[a.source] || (a.title < b.title ? -1 : 1),
  ).slice(0, limit);

  const note = actions.length
    ? `${actions.length} suggested action(s) synthesized from the live intelligence — propose-only, nothing is auto-executed.`
    : "No actions to suggest — the live intelligence is clear, or everything actionable is already in the queue.";

  return { actions, note };
}
