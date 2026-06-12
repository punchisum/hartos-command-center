/**
 * tests/fitness-mutation-adapter.test.ts — P5: the fitness "hand" (inside the fence).
 *
 * Autonomous fitness acts on Hart's own training only. The deterministic FitnessAdjustment
 * (band × load → action + caloriePct, decided upstream by deriveFitnessAdjustment — never an LLM)
 * is applied for ONE state_date through an injected store, with the same disciplines as every
 * external adapter: read-before-write, idempotency (the same band's adjustment re-applies 0), a
 * full before/after payload, a dry-run, and a default-OFF allowlist flag under the kill-switch.
 *
 * All I/O is the injected FitnessMutationStore (a fake here; the live RPC-backed store on the host).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fitnessMutationAdapter,
  FITNESS_ADJUST_FLAG,
  type FitnessMutationStore,
  type FitnessDaySnapshot,
} from "../src/execution/adapters/fitness-mutation.js";
import type { FitnessAdjustment } from "../src/fitness/fitness-adjustment-rules.js";

const DATE = "2026-06-12";
const GREEN_HARD: FitnessAdjustment = { action: "as-planned", caloriePct: 10, reason: "Green recovery — fuel the load." };

function makeStore(day: FitnessDaySnapshot | null): FitnessMutationStore & { applied: Array<{ band: string; caloriePct: number }> } {
  let snap = day;
  const applied: Array<{ band: string; caloriePct: number }> = [];
  return {
    applied,
    async getDay() { return snap; },
    async applyAdjustment(input) {
      applied.push({ band: input.band, caloriePct: input.caloriePct });
      snap = snap ? { ...snap, appliedBand: input.band } : null;
    },
  };
}

describe("fitnessMutationAdapter", () => {
  it("exposes the default-OFF allowlist flag", () => {
    assert.equal(fitnessMutationAdapter.allowlistFlag, FITNESS_ADJUST_FLAG);
    assert.equal(FITNESS_ADJUST_FLAG, "HARTOS_ALLOW_FITNESS_ADJUST");
  });

  it("applies a green/hard adjustment once: before/after carries the calorie target change", async () => {
    const store = makeStore({ stateDate: DATE, calorieBase: 2000, appliedBand: null });
    const out = await fitnessMutationAdapter.execute({ store, stateDate: DATE, recoveryBand: "green", adjustment: GREEN_HARD });
    assert.equal(out.ran, true);
    assert.equal(out.reversible, true);
    assert.equal(store.applied.length, 1);
    assert.equal((out.before as Record<string, unknown>).calorieTarget, 2000);
    assert.equal((out.after as Record<string, unknown>).calorieTarget, 2200, "+10% of 2000");
    assert.equal((out.after as Record<string, unknown>).band, "green");
    assert.equal((out.after as Record<string, unknown>).action, "as-planned");
  });

  it("is idempotent: the same band's adjustment already applied ⇒ no-op (0 writes)", async () => {
    const store = makeStore({ stateDate: DATE, calorieBase: 2000, appliedBand: "green" });
    const out = await fitnessMutationAdapter.execute({ store, stateDate: DATE, recoveryBand: "green", adjustment: GREEN_HARD });
    assert.equal(out.ran, false);
    assert.equal(store.applied.length, 0, "already-applied band re-applies nothing");
  });

  it("refuses (writes nothing) when there is no fitness state for the date", async () => {
    const store = makeStore(null);
    const out = await fitnessMutationAdapter.execute({ store, stateDate: DATE, recoveryBand: "green", adjustment: GREEN_HARD });
    assert.equal(out.ran, false);
    assert.equal(store.applied.length, 0);
    assert.match(out.summary, /no fitness state|not found/i);
  });

  it("dry-run reports what WOULD change and writes nothing", async () => {
    const store = makeStore({ stateDate: DATE, calorieBase: 2000, appliedBand: null });
    const out = await fitnessMutationAdapter.dryRun({ store, stateDate: DATE, recoveryBand: "green", adjustment: GREEN_HARD });
    assert.equal(out.ran, false);
    assert.equal(store.applied.length, 0);
    assert.match(out.summary, /dry-run/i);
    assert.equal((out.after as Record<string, unknown>).calorieTarget, 2200);
  });

  it("a defer (red/hard) adjustment carries the defer action with no calorie change", async () => {
    const store = makeStore({ stateDate: DATE, calorieBase: 2000, appliedBand: null });
    const defer: FitnessAdjustment = { action: "defer", caloriePct: 0, reason: "Red — defer the hard session." };
    const out = await fitnessMutationAdapter.execute({ store, stateDate: DATE, recoveryBand: "red", adjustment: defer });
    assert.equal(out.ran, true);
    assert.equal((out.after as Record<string, unknown>).action, "defer");
    assert.equal((out.after as Record<string, unknown>).calorieTarget, 2000, "0% — no calorie change");
  });
});
