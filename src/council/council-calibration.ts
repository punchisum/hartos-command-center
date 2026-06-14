// src/council/council-calibration.ts
/**
 * P8 — the learned knob. The empirical approval priors per confidence band and a
 * DEMOTE-ONLY calibration function. P8 rewrites COUNCIL_BAND_APPROVAL's three
 * numeric literals via the §6 self-mod gauntlet. PURE — never throws.
 *
 * Demote-only is the load-bearing invariant: calibration may only present a band
 * LOWER than the §19 raw band, never higher. So the loop can only ever make
 * HartOS more conservative about itself — never overconfident.
 */
import type { Confidence } from "./council-types.js";

/**
 * Empirical approval priors per band — the fraction of DECIDED council proposals at
 * this stated (raw) band that Hart APPROVED. Seeded neutral (0.5). P8 recalibrates
 * these three literals; the self-mod scope guard allows edits to this file.
 */
export const COUNCIL_BAND_APPROVAL: Record<Confidence, number> = {
  low: 0.5,
  medium: 0.5,
  high: 0.5,
};

/** A band whose empirical approval falls strictly below this is demoted one step when presented. */
export const COUNCIL_DEMOTE_BELOW = 0.5;

const DEMOTE_ONE_STEP: Record<Confidence, Confidence> = {
  high: "medium",
  medium: "low",
  low: "low", // floor — never below low
};

/**
 * DEMOTE-ONLY calibration. Returns a band no HIGHER than `raw`.
 * If the raw band's prior is below COUNCIL_DEMOTE_BELOW, present it one step lower.
 * PURE — never throws.
 */
export function calibrateConfidence(
  raw: Confidence,
  priors: Record<Confidence, number> = COUNCIL_BAND_APPROVAL,
): Confidence {
  const prior = typeof priors[raw] === "number" ? priors[raw] : 0.5;
  if (raw !== "low" && prior < COUNCIL_DEMOTE_BELOW) {
    return DEMOTE_ONE_STEP[raw];
  }
  return raw;
}
