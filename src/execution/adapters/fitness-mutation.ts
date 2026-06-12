/**
 * src/execution/adapters/fitness-mutation.ts — P5: the autonomous-fitness "hand" (inside the fence).
 *
 * Applies ONE deterministic FitnessAdjustment (band × load → action + caloriePct, decided upstream
 * by deriveFitnessAdjustment — NEVER an LLM) for a single state_date. Blast radius = Hart's own
 * training. Same disciplines as every external adapter, by construction:
 *   • read-before-write — the day's live snapshot is read first; refuses if there is no state,
 *   • idempotency — the SAME recovery band's adjustment already applied ⇒ no-op (a re-run applies 0),
 *   • before/after — { calorieTarget: base, band: prior } → { calorieTarget: adjusted, band, action },
 *   • dry-run — read-only: report what WOULD change, write nothing,
 *   • reversible — revert by re-applying the original (band "none", 0%, as-planned).
 *
 * All I/O goes through an injected `FitnessMutationStore` (a fake in tests, the RPC-backed live
 * store on the Node host). Gated like every adapter: its own allowlist flag (default OFF) under the
 * global kill-switch — so nothing mutates until HARTOS_ALLOW_FITNESS_ADJUST is deliberately armed.
 */

import type { ExecutionAdapter, ExecutionOutcome } from "../execution-adapter.js";
import type { FitnessAdjustment } from "../../fitness/fitness-adjustment-rules.js";

/** The day's live snapshot — the read-before-write target. */
export interface FitnessDaySnapshot {
  stateDate: string;
  /** The base calorie target before any recovery adjustment. */
  calorieBase: number;
  /** Which recovery band's adjustment is already applied for this date (idempotency), or null. */
  appliedBand: string | null;
}

export interface FitnessMutationStore {
  /** Read-before-write: the day's snapshot, or null if there is no fitness state for the date. */
  getDay(stateDate: string): Promise<FitnessDaySnapshot | null>;
  /** Apply the adjustment for the date+band. Called ONLY after the live read confirmed it's new. */
  applyAdjustment(input: { stateDate: string; band: string; action: string; caloriePct: number }): Promise<void>;
}

export interface FitnessMutationDeps {
  store: FitnessMutationStore;
  stateDate: string;
  recoveryBand: "green" | "amber" | "red";
  adjustment: FitnessAdjustment;
}

/** Per-action allowlist flag — absent by default, so autonomous fitness is OFF until armed. */
export const FITNESS_ADJUST_FLAG = "HARTOS_ALLOW_FITNESS_ADJUST";

/** The adjusted calorie target for a base + percent change (rounded to whole kcal). */
function calorieTarget(base: number, caloriePct: number): number {
  return Math.round(base * (1 + caloriePct / 100));
}

/** A no-write refusal (no fitness state to adjust). */
function refused(reason: string, dry: boolean): ExecutionOutcome {
  return { ran: false, reversible: true, before: {}, after: {}, summary: `${dry ? "Dry-run REFUSED" : "REFUSED"}: ${reason}. No write performed.` };
}

/** An idempotent no-op (this band's adjustment is already applied for the date). */
function noop(day: FitnessDaySnapshot, band: string): ExecutionOutcome {
  return {
    ran: false,
    reversible: true,
    before: { calorieTarget: day.calorieBase, band },
    after: { calorieTarget: day.calorieBase, band },
    summary: `No-op: the ${band} adjustment is already applied on ${day.stateDate}; a re-run applies 0.`,
  };
}

export const fitnessMutationAdapter: ExecutionAdapter<FitnessMutationDeps> = {
  id: "fitness-mutation",
  allowlistFlag: FITNESS_ADJUST_FLAG,

  async dryRun(deps): Promise<ExecutionOutcome> {
    const day = await deps.store.getDay(deps.stateDate);
    if (!day) return refused(`no fitness state for ${deps.stateDate}`, true);
    if (day.appliedBand === deps.recoveryBand) return noop(day, deps.recoveryBand);
    const target = calorieTarget(day.calorieBase, deps.adjustment.caloriePct);
    return {
      ran: false,
      reversible: true,
      before: { calorieTarget: day.calorieBase, band: day.appliedBand ?? "none" },
      after: { calorieTarget: target, band: deps.recoveryBand, action: deps.adjustment.action, caloriePct: deps.adjustment.caloriePct },
      summary: `Dry-run: would apply the ${deps.recoveryBand} adjustment on ${deps.stateDate} — ${deps.adjustment.action}, ${deps.adjustment.caloriePct}% → ${target} kcal. No write performed.`,
    };
  },

  async execute(deps): Promise<ExecutionOutcome> {
    // 1) Read-before-write. No state ⇒ refuse, write nothing.
    const day = await deps.store.getDay(deps.stateDate);
    if (!day) return refused(`no fitness state for ${deps.stateDate}`, false);

    // 2) Idempotency: this band's adjustment already applied ⇒ no-op.
    if (day.appliedBand === deps.recoveryBand) return noop(day, deps.recoveryBand);

    // 3) Apply the single mutation — reversible (revert by re-applying none/0%/as-planned).
    await deps.store.applyAdjustment({
      stateDate: deps.stateDate,
      band: deps.recoveryBand,
      action: deps.adjustment.action,
      caloriePct: deps.adjustment.caloriePct,
    });
    const target = calorieTarget(day.calorieBase, deps.adjustment.caloriePct);
    return {
      ran: true,
      reversible: true,
      before: { calorieTarget: day.calorieBase, band: day.appliedBand ?? "none" },
      after: { calorieTarget: target, band: deps.recoveryBand, action: deps.adjustment.action, caloriePct: deps.adjustment.caloriePct },
      summary: `Applied the ${deps.recoveryBand} adjustment on ${deps.stateDate}: ${deps.adjustment.action}, ${deps.adjustment.caloriePct}% → ${target} kcal. ${deps.adjustment.reason} Revert: re-apply none/0%/as-planned.`,
    };
  },
};
