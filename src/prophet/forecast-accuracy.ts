/**
 * src/prophet/forecast-accuracy.ts
 *
 * Scores Prophet's CONSEQUENCE-OF-INACTION forecasts against what actually happened — the learning
 * loop that turns "forecasts" into "forecasts we can trust". PURE + DETERMINISTIC.
 *
 * The method, grounded in Prophet's own claim ("known issues don't heal on their own"):
 *   - Each daily pulse records the consequence SUBJECTS it predicted.
 *   - For each consecutive pair (older → newer), a predicted subject that STILL appears in the next
 *     pulse PERSISTED — the forecast HELD (it didn't self-heal, exactly as projected). One that is
 *     GONE RESOLVED (Hart acted, or it cleared).
 *   - persistenceRate = persisted / predicted = how often Prophet's "won't self-heal" call was
 *     right. A high rate VALIDATES the forecast; a low one means consequences clear on their own
 *     more than projected (Prophet is too pessimistic) — either way it's an honest self-measurement.
 *
 * Honest about scope: with fewer than two pulses carrying predictions there is nothing to score, so
 * status is "insufficient_history" and no rate is invented.
 */

import type { PulseRun } from "../cockpit/pulse/pulse-run-spine.js";

export interface ForecastAccuracy {
  status: "ok" | "insufficient_history";
  /** Consecutive pulse pairs that contributed to the score. */
  pairsScored: number;
  /** Predicted consequence subjects (from the older pulse of each scored pair). */
  predicted: number;
  /** Predicted subjects that persisted into the next pulse (the forecast held). */
  persisted: number;
  /** Predicted subjects that were gone in the next pulse (resolved/cleared). */
  resolved: number;
  /** persisted / predicted, rounded to 2dp (0..1); 0 when nothing predicted. */
  persistenceRate: number;
  note: string;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Score forecast accuracy over a list of pulse runs (any order — sorted oldest→newest internally).
 * Compares each consecutive pair's predicted consequence subjects.
 */
export function scoreForecastAccuracy(runs: PulseRun[], opts: { minPulses?: number } = {}): ForecastAccuracy {
  const minPulses = Math.max(2, opts.minPulses ?? 2);
  const sorted = [...runs]
    .filter((r) => typeof r.at === "string" && r.at.length > 0)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  if (sorted.length < minPulses) {
    return {
      status: "insufficient_history",
      pairsScored: 0,
      predicted: 0,
      persisted: 0,
      resolved: 0,
      persistenceRate: 0,
      note: `INSUFFICIENT_HISTORY — ${sorted.length} pulse(s); need ≥ ${minPulses} before forecast accuracy can be scored. No invented rate.`,
    };
  }

  let predicted = 0;
  let persisted = 0;
  let pairsScored = 0;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const older = sorted[i]!;
    const newer = sorted[i + 1]!;
    if (older.consequenceSubjects.length === 0) continue;
    pairsScored += 1;
    const nextSet = new Set(newer.consequenceSubjects.map(norm));
    for (const subj of older.consequenceSubjects) {
      predicted += 1;
      if (nextSet.has(norm(subj))) persisted += 1;
    }
  }

  const resolved = predicted - persisted;
  const persistenceRate = predicted > 0 ? Math.round((persisted / predicted) * 100) / 100 : 0;
  const note =
    predicted === 0
      ? `No predicted consequences to score across ${sorted.length} pulse(s) — nothing forecast yet.`
      : `Across ${pairsScored} consecutive pulse pair(s): ${persisted}/${predicted} predicted consequences persisted (${resolved} resolved) — Prophet's "won't self-heal" held ${Math.round(persistenceRate * 100)}%.`;

  return {
    status: predicted === 0 ? "insufficient_history" : "ok",
    pairsScored,
    predicted,
    persisted,
    resolved,
    persistenceRate,
    note,
  };
}

/** One-line summary for a cockpit header. */
export function summarizeForecastAccuracy(a: ForecastAccuracy): string {
  if (a.status === "insufficient_history") return "Forecast accuracy: not enough pulses yet.";
  return `Forecast accuracy: ${Math.round(a.persistenceRate * 100)}% of predicted consequences held (${a.persisted}/${a.predicted}).`;
}
