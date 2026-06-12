/**
 * tests/fitness-mutation-db.test.ts — P5: the live pg-backed fitness store (RPC contract pinned).
 *
 * Fitness data lives in the SAME DB as the cockpit spine (Hart Personal Core), so the store reaches
 * it through the same elevated pg handle and calls the fitness RPCs by name. This pins the exact
 * RPC contract the fitness-repo migration must satisfy (consumer-driven, like the other *-db.ts):
 *   • getDay        → get_fitness_adjust_state(user, agent, state_date) → { calorie_base, applied_band }
 *   • applyAdjustment → apply_fitness_recovery_adjustment(user, agent, date, band, action, pct)
 *     (one atomic RPC: sets the plan + calorie adjustment AND marks applied_band for idempotency).
 *
 * Hermetic: an injected fake Queryable captures the SQL + params; no pg, no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeFitnessMutationStore, type Queryable } from "../src/fitness/fitness-mutation-db.js";

const CTX = { userId: "u-1", agentId: "a-1" };

function fakeDb(results: Array<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>) {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  let i = 0;
  const db: Queryable = {
    async query(text, params) { calls.push({ text, params }); return results[i++] ?? { rows: [], rowCount: 0 }; },
  };
  return { db, calls };
}

describe("fitness-mutation DB store — RPC contract", () => {
  it("getDay calls get_fitness_adjust_state(user, agent, state_date) and maps the row", async () => {
    const { db, calls } = fakeDb([{ rows: [{ calorie_base: 2000, applied_band: null }], rowCount: 1 }]);
    const snap = await makeFitnessMutationStore(db, CTX).getDay("2026-06-12");
    assert.deepEqual(snap, { stateDate: "2026-06-12", calorieBase: 2000, appliedBand: null });
    assert.match(calls[0]!.text, /get_fitness_adjust_state/i);
    assert.deepEqual(calls[0]!.params, ["u-1", "a-1", "2026-06-12"]);
  });

  it("getDay maps an already-applied band through", async () => {
    const { db } = fakeDb([{ rows: [{ calorie_base: 1800, applied_band: "amber" }], rowCount: 1 }]);
    const snap = await makeFitnessMutationStore(db, CTX).getDay("2026-06-12");
    assert.equal(snap?.appliedBand, "amber");
    assert.equal(snap?.calorieBase, 1800);
  });

  it("getDay returns null when there is no row for the date", async () => {
    const { db } = fakeDb([{ rows: [], rowCount: 0 }]);
    assert.equal(await makeFitnessMutationStore(db, CTX).getDay("2026-06-12"), null);
  });

  it("applyAdjustment calls the single atomic apply RPC with date/band/action/pct", async () => {
    const { db, calls } = fakeDb([{ rows: [], rowCount: 1 }]);
    await makeFitnessMutationStore(db, CTX).applyAdjustment({ stateDate: "2026-06-12", band: "green", action: "as-planned", caloriePct: 10 });
    assert.match(calls[0]!.text, /apply_fitness_recovery_adjustment/i);
    assert.deepEqual(calls[0]!.params, ["u-1", "a-1", "2026-06-12", "green", "as-planned", 10]);
  });
});
