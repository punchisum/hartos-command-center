/**
 * tests/fitness-mutation-dispatch.test.ts — P5: the fitness "hand" rides the gated dispatch path.
 *
 * A fitness adjustment dispatches through the SAME `dispatchMutation` every other mutation uses —
 * the gate still fail-closed (flag OFF ⇒ no write), and a real write projects a §13 fitness delta.
 * Blast radius = Hart's own training.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dispatchMutation } from "../src/execution/execution-dispatch.js";
import { FITNESS_ADJUST_FLAG, type FitnessMutationStore, type FitnessDaySnapshot } from "../src/execution/adapters/fitness-mutation.js";
import type { FitnessAdjustment } from "../src/fitness/fitness-adjustment-rules.js";

const NOW = new Date("2026-06-12T22:00:00.000Z");
const PROPOSAL = { id: "p-fit", status: "approved_for_execution" as const, expiresAt: null };
const ADJ: FitnessAdjustment = { action: "as-planned", caloriePct: 10, reason: "Green — fuel the load." };

function fitnessStore(day: FitnessDaySnapshot | null): FitnessMutationStore {
  let snap = day;
  return {
    async getDay() { return snap; },
    async applyAdjustment(input) { snap = snap ? { ...snap, appliedBand: input.band } : null; },
  };
}

function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.log;
  console.log = () => {};
  return fn().finally(() => { console.log = orig; });
}

describe("dispatchMutation — fitness-mutation", () => {
  it("armed flag → applies once and projects a fitness delta with before/after", async () => {
    const store = fitnessStore({ stateDate: "2026-06-12", calorieBase: 2000, appliedBand: null });
    const out = await quiet(() => dispatchMutation(
      { adapterId: "fitness-mutation", proposal: PROPOSAL, target: { stateDate: "2026-06-12", recoveryBand: "green", adjustment: ADJ }, store },
      { [FITNESS_ADJUST_FLAG]: "true" },
      { now: NOW, hasCapabilityToken: true },
    ));
    assert.equal(out.result.executed, true);
    assert.ok(out.delta, "a real write projects a delta");
    assert.equal(out.delta!.domain, "fitness");
    assert.equal(out.delta!.actionType, "fitness_adjustment_plan");
    assert.equal((out.delta!.after as Record<string, unknown>).calorieTarget, 2200);
  });

  it("flag OFF (default) → refused, NULL delta, nothing applied", async () => {
    const store = fitnessStore({ stateDate: "2026-06-12", calorieBase: 2000, appliedBand: null });
    const out = await quiet(() => dispatchMutation(
      { adapterId: "fitness-mutation", proposal: PROPOSAL, target: { stateDate: "2026-06-12", recoveryBand: "green", adjustment: ADJ }, store },
      {},
      { now: NOW, hasCapabilityToken: true },
    ));
    assert.equal(out.result.executed, false);
    assert.equal(out.delta, null, "a refusal emits no delta");
  });
});
