// tests/p8-calibrate-pass.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mapRowsToRecords,
  runP8CalibrateCore,
  type P8PassDeps,
} from "../scripts/run-p8-calibrate-pass.js";
import type { Confidence } from "../src/council/council-types.js";
import type { SelfModTask } from "../src/execution/self-mod-pass.js";

const NEUTRAL: Record<Confidence, number> = { low: 0.5, medium: 0.5, high: 0.5 };

// Build a persisted-row shape: the payload column is the WHOLE ProposalQueueItem.
const row = (status: string, confidence: string) => ({
  status,
  payload: { proposedPayload: { confidence, rootGoal: "g", recommendation: "r", tree: {}, llmCallsUsed: 0 } },
});

describe("mapRowsToRecords", () => {
  it("derives (raw confidence, decision) from the status column + proposedPayload", () => {
    const recs = mapRowsToRecords([
      row("simulated_approved", "high"),
      row("rejected", "high"),
      row("pending_approval", "medium"),
    ]);
    assert.deepEqual(recs[0], { confidence: "high", decision: "approved" });
    assert.deepEqual(recs[1], { confidence: "high", decision: "rejected" });
    assert.deepEqual(recs[2], { confidence: "medium", decision: "pending" });
  });

  it("tolerates a string-encoded payload + missing/invalid fields", () => {
    const recs = mapRowsToRecords([
      { status: "simulated_approved", payload: JSON.stringify({ proposedPayload: { confidence: "low" } }) },
      { status: "rejected", payload: null },
      { status: 42 as any, payload: {} },
    ]);
    assert.deepEqual(recs[0], { confidence: "low", decision: "approved" });
    assert.equal(recs[1].decision, "rejected");
    assert.equal(recs[1].confidence, "low"); // invalid → low
    assert.equal(recs.length, 3);
  });
});

describe("runP8CalibrateCore", () => {
  const baseDeps = (over: Partial<P8PassDeps>): P8PassDeps => ({
    queryCouncilRows: async () => [],
    enqueue: () => {},
    currentPriors: NEUTRAL,
    ...over,
  });

  it("insufficient sample → no enqueue, honest log line", async () => {
    const enq: SelfModTask[] = [];
    const lines = await runP8CalibrateCore(baseDeps({
      queryCouncilRows: async () => [row("simulated_approved", "high"), row("rejected", "high")], // 2 decided < minSample 4
      enqueue: (t) => enq.push(t),
    }));
    assert.equal(enq.length, 0);
    assert.ok(lines[0].includes("insufficient sample"));
  });

  it("within deadband → no enqueue, no-op log line", async () => {
    const enq: SelfModTask[] = [];
    // 5 high runs, 3 approved → 0.6 vs 0.5 = gap 0.1 ... actually clears deadband; use 0.5 exactly:
    const rows = [
      row("simulated_approved", "high"), row("simulated_approved", "high"),
      row("rejected", "high"), row("rejected", "high"),
    ]; // 2/4 = 0.5 == current → gap 0
    const lines = await runP8CalibrateCore(baseDeps({
      queryCouncilRows: async () => rows,
      enqueue: (t) => enq.push(t),
    }));
    assert.equal(enq.length, 0);
    assert.ok(lines[0].includes("deadband") || lines[0].includes("no-op"));
  });

  it("well-evidenced delta → enqueues exactly one recalibrate task", async () => {
    const enq: SelfModTask[] = [];
    const rows = [
      row("rejected", "high"), row("rejected", "high"), row("rejected", "high"),
      row("rejected", "high"), row("simulated_approved", "high"),
    ]; // 1/5 = 0.2 vs 0.5 → gap 0.3 > deadband, sample 5 ≥ 4
    const lines = await runP8CalibrateCore(baseDeps({
      queryCouncilRows: async () => rows,
      enqueue: (t) => enq.push(t),
    }));
    assert.equal(enq.length, 1);
    assert.equal(enq[0].selfModClass, "recalibrate");
    assert.ok(enq[0].description.includes("council-calibration.ts"));
    assert.ok(lines[0].includes("enqueued"));
  });

  it("never throws — a throwing query yields a redacted error line", async () => {
    const lines = await runP8CalibrateCore(baseDeps({
      queryCouncilRows: async () => { throw new Error("boom"); },
    }));
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes("error"));
  });
});
