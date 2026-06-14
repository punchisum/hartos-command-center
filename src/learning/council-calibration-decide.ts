// src/learning/council-calibration-decide.ts
/**
 * P8 — pure decision step. Given the current priors and the aggregate, propose a
 * bounded move of each band's prior toward its observed approval rate, but only when
 * the band has enough decided samples and the gap clears the deadband. Build a
 * surgical, deterministic self-mod description that names the file, the symbol, and
 * each old→new literal. Empty deltas ⇒ honest no-op (null description).
 * PURE — never throws.
 */
import type { Confidence } from "../council/council-types.js";
import type { CalibrationAggregate } from "./council-calibration-aggregate.js";

export interface CalibrationTuning {
  minSample: number; // min decided runs in a band before we touch it
  deadband: number; // min |observed − current| to bother
  step: number; // max move toward observed per run
}

/** RESPONSIVE defaults (Hart-approved 2026-06-14). */
export const DEFAULT_TUNING: CalibrationTuning = { minSample: 4, deadband: 0.05, step: 0.2 };

export interface BandDelta {
  band: Confidence;
  from: number; // current prior (2dp)
  to: number; // proposed prior (2dp)
  decided: number;
  approvalRate: number;
}

export interface CalibrationDecision {
  deltas: BandDelta[]; // empty ⇒ no-op
  description: string | null; // surgical SelfModTask.description, or null when deltas empty
}

const BANDS: Confidence[] = ["low", "medium", "high"];
const round2 = (x: number): number => Math.round(x * 100) / 100;

export function decideCalibration(
  current: Record<Confidence, number>,
  aggregate: CalibrationAggregate,
  tuning: CalibrationTuning = DEFAULT_TUNING,
): CalibrationDecision {
  const deltas: BandDelta[] = [];
  const byBand = aggregate && typeof aggregate === "object" ? aggregate.byBand : undefined;

  for (const band of BANDS) {
    const stat = byBand?.[band];
    if (!stat || stat.decided < tuning.minSample) continue;

    const cur = typeof current[band] === "number" ? current[band] : 0.5;
    const observed = stat.approvalRate;
    const gap = observed - cur;
    if (Math.abs(gap) < tuning.deadband) continue;

    // Move toward observed, bounded by step.
    const move = Math.sign(gap) * Math.min(tuning.step, Math.abs(gap));
    const to = round2(cur + move);
    if (to === round2(cur)) continue; // rounding made it a no-op

    deltas.push({ band, from: round2(cur), to, decided: stat.decided, approvalRate: round2(observed) });
  }

  if (deltas.length === 0) return { deltas: [], description: null };

  const setLines = deltas.map((d) => `  - set ${d.band}: ${d.from}  → ${d.to}`).join("\n");
  const rationale = deltas
    .map((d) => `${d.band} approved ${Math.round(d.approvalRate * 100)}% over ${d.decided} decided runs`)
    .join("; ");

  const description =
    `Recalibrate council confidence priors in src/council/council-calibration.ts.\n` +
    `Change ONLY the numeric literals inside the COUNCIL_BAND_APPROVAL object:\n` +
    `${setLines}\n` +
    `Do not modify COUNCIL_DEMOTE_BELOW, calibrateConfidence, any other file, or any other line.\n` +
    `Rationale: ${rationale}.`;

  return { deltas, description };
}
