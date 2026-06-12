/**
 * tests/fitness-pending-poll.test.ts — P5: poll the fitness side's pending mutations (RPC contract).
 *
 * The live-runner calls get_pending_mutations (same DB) and maps each row to a PendingFitnessMutation
 * the ingest layer materialises. This pins the read RPC contract the fitness-repo migration provides:
 *   get_pending_mutations(p_user_id, p_agent_id, p_limit)
 *     → rows { state_date, recovery_band, recovery_score, action, calorie_pct, reason, idempotency_key }
 *
 * Hermetic: an injected fake Queryable captures the SQL + params; rows with a bad band are dropped.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makePendingFitnessPoller, type Queryable } from "../src/fitness/fitness-pending-poll.js";

const CTX = { userId: "u-1", agentId: "a-1" };

function fakeDb(rows: Array<Record<string, unknown>>) {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const db: Queryable = {
    async query(text, params) { calls.push({ text, params }); return { rows, rowCount: rows.length }; },
  };
  return { db, calls };
}

const ROW = {
  state_date: "2026-06-12", recovery_band: "green", recovery_score: 84,
  action: "as-planned", calorie_pct: 10, reason: "Green — fuel.", idempotency_key: "2026-06-12:green",
};

describe("pending fitness poller — RPC contract", () => {
  it("calls get_pending_mutations(user, agent, limit) and maps rows to PendingFitnessMutation", async () => {
    const { db, calls } = fakeDb([ROW]);
    const out = await makePendingFitnessPoller(db, CTX).pollPending(25);
    assert.match(calls[0]!.text, /get_pending_mutations/i);
    assert.deepEqual(calls[0]!.params, ["u-1", "a-1", 25]);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], {
      stateDate: "2026-06-12", recoveryBand: "green", recoveryScore: 84,
      action: "as-planned", caloriePct: 10, reason: "Green — fuel.", idempotencyKey: "2026-06-12:green",
    });
  });

  it("defaults the limit when not given", async () => {
    const { db, calls } = fakeDb([]);
    await makePendingFitnessPoller(db, CTX).pollPending();
    assert.equal(typeof calls[0]!.params![2], "number");
  });

  it("drops rows with an unrecognised recovery band (never materialise garbage)", async () => {
    const { db } = fakeDb([ROW, { ...ROW, recovery_band: "blue", idempotency_key: "x" }]);
    const out = await makePendingFitnessPoller(db, CTX).pollPending();
    assert.equal(out.length, 1, "the bad-band row is dropped");
    assert.equal(out[0]!.recoveryBand, "green");
  });

  it("returns an empty list when there are no pending mutations", async () => {
    const { db } = fakeDb([]);
    assert.deepEqual(await makePendingFitnessPoller(db, CTX).pollPending(), []);
  });
});
