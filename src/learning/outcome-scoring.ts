/**
 * src/learning/outcome-scoring.ts — the CLOSED learning loop's measuring half (PURE).
 *
 * HartOS executes a fix — did it work? Until now nothing recorded that: the DecisionRecord.outcome
 * was null forever, so memory stored CAUSE (a proposal executed) but never EFFECT, and the proposer
 * could not learn from results. This module is the missing measurement: compare an executed
 * proposal's TARGET SUBJECT against the subjects still present in a LATER pulse.
 *   - gone        ⇒ resolved (the fix held / the issue cleared)
 *   - still there ⇒ persisted (the action did not resolve its target)
 *   - no subject  ⇒ unknown (never guessed)
 *
 * Pure + deterministic. The pulse persists these verdicts (cockpit_decision_outcomes), and
 * efficacyByActionType turns the history into a per-action-type track record the proposer + the
 * state report can consult. Honest by construction: matching is LOOSE (substring, like
 * historicalContextFor) and this is a v1 SIGNAL, not a proof of causation — recorded as such.
 */

export type DecisionOutcome = "resolved" | "persisted" | "unknown";

export interface ExecutedTarget {
  proposalId: string;
  actionType: string;
  /** The subject the proposal was meant to resolve (the finding/risk it targeted). */
  subject: string;
}

export interface ScoredOutcome extends ExecutedTarget {
  outcome: DecisionOutcome;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Loose presence test — a subject counts as still-present on any substring overlap (either way). */
export function subjectStillPresent(subject: string, currentSubjects: Iterable<string>): boolean {
  const key = norm(subject);
  if (!key) return false;
  for (const c of currentSubjects) {
    const cn = norm(c);
    if (cn && (cn === key || cn.includes(key) || key.includes(cn))) return true;
  }
  return false;
}

/** Classify each executed proposal against the subjects present in the observing pulse. */
export function classifyExecutedOutcomes(executed: ExecutedTarget[], currentSubjects: string[]): ScoredOutcome[] {
  const present = currentSubjects.map(norm).filter(Boolean);
  return executed.map((e) => {
    const outcome: DecisionOutcome = !norm(e.subject)
      ? "unknown"
      : subjectStillPresent(e.subject, present)
        ? "persisted"
        : "resolved";
    return { ...e, outcome };
  });
}

export interface ActionEfficacy {
  actionType: string;
  resolved: number;
  persisted: number;
  total: number;
  /** resolved / (resolved + persisted), 0..1 to 2dp; null when no decisive outcomes. */
  rate: number | null;
}

/**
 * Roll a history of scored outcomes into a per-action-type efficacy track record. Unknowns are
 * excluded (they carry no signal). Sorted by sample size (most-decided first) — so the proposer
 * weights the action types it actually has evidence for.
 */
export function efficacyByActionType(history: Array<{ actionType: string; outcome: DecisionOutcome }>): ActionEfficacy[] {
  const map = new Map<string, { resolved: number; persisted: number }>();
  for (const h of history) {
    if (h.outcome === "unknown") continue;
    const e = map.get(h.actionType) ?? { resolved: 0, persisted: 0 };
    if (h.outcome === "resolved") e.resolved += 1;
    else e.persisted += 1;
    map.set(h.actionType, e);
  }
  return [...map.entries()]
    .map(([actionType, e]) => {
      const total = e.resolved + e.persisted;
      return { actionType, resolved: e.resolved, persisted: e.persisted, total, rate: total > 0 ? Math.round((e.resolved / total) * 100) / 100 : null };
    })
    .sort((a, b) => b.total - a.total);
}

/** One-line summary for the report / a cockpit header. */
export function summarizeEfficacy(eff: ActionEfficacy[]): string {
  if (eff.length === 0) return "Action efficacy: no decisive outcomes recorded yet.";
  const parts = eff.map((e) => `${e.actionType} ${e.rate === null ? "n/a" : `${Math.round(e.rate * 100)}%`} (${e.resolved}/${e.total})`);
  return `Action efficacy: ${parts.join(" · ")}.`;
}
