/**
 * src/fitness/fitness-adjustment-rules.ts — Phase 5 decision core (PURE, deterministic).
 *
 * Autonomous fitness acts on its own, but the WHAT is decided by fixed rules over the recovery
 * verdict — never by an LLM. This maps (recovery band × training load) to a concrete adjustment the
 * mutation path can apply + report. Blast radius is Hart's own training (inside the fence).
 * PURE: no I/O, no clock, no env.
 */

export type RecoveryBand = "green" | "amber" | "red";
export type LoadTier = "rest" | "easy" | "moderate" | "hard";

export interface FitnessAdjustment {
  action: "as-planned" | "controlled" | "defer";
  /** Percent change to the day's calorie target (fuel the load / hold on poor recovery). */
  caloriePct: number;
  reason: string;
}

export function deriveFitnessAdjustment(band: RecoveryBand, load: LoadTier): FitnessAdjustment {
  if (band === "red") {
    if (load === "hard") {
      return { action: "defer", caloriePct: 0, reason: "Red recovery — defer the hard session; train it another day." };
    }
    if (load === "rest") {
      return { action: "as-planned", caloriePct: 0, reason: "Red recovery on a rest day — nothing to change." };
    }
    return { action: "controlled", caloriePct: 0, reason: "Red recovery — keep effort controlled, hold intake." };
  }
  if (band === "amber") {
    return { action: "controlled", caloriePct: load === "hard" ? 5 : 0, reason: "Amber recovery — controlled effort." };
  }
  return {
    action: "as-planned",
    caloriePct: load === "hard" ? 10 : load === "moderate" ? 5 : 0,
    reason: "Green recovery — proceed as planned; fuel the load.",
  };
}
