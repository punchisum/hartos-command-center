// tests/p8-calibrate-core.test.ts
/**
 * P8 — end-to-end proof of the council-calibration pass via its injectable seam.
 *
 * Drives runP8CalibrateCore with a STUB queryCouncilRows (synthetic rows only —
 * no DB, no real council data) and a capturing enqueue (push to an array). This
 * exercises the WHOLE pure pipeline: mapRowsToRecords → aggregateCalibration →
 * decideCalibration → enqueue, against the real aggregate/decide logic.
 *
 * Doctrine: no fabrication of real rows. These are synthetic inputs in a test;
 * the real DB + real enqueue + the HARTOS_ALLOW_LEARNING gate live only in
 * runP8CalibrateOnce, which this test never calls. No logic is changed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runP8CalibrateCore,
  type P8PassDeps,
} from "../scripts/run-p8-calibrate-pass.js";
import type { Confidence } from "../src/council/council-types.js";
import type { SelfModTask } from "../src/execution/self-mod-pass.js";

// currentPriors default = COUNCIL_BAND_APPROVAL — all neutral 0.5.
const NEUTRAL: Record<Confidence, number> = { low: 0.5, medium: 0.5, high: 0.5 };

/**
 * The exact persisted-row shape mapRowsToRecords expects: the `payload` column is
 * the WHOLE ProposalQueueItem, so the raw council confidence lives at
 * payload.proposedPayload.confidence; the live `status` column drives the decision
 * (simulated_approved → approved, rejected → rejected, else → pending).
 */
const row = (status: string, confidence: string) => ({
  status,
  payload: {
    proposedPayload: {
      confidence,
      rootGoal: "synthetic goal",
      recommendation: "synthetic rec",
      tree: {},
      llmCallsUsed: 0,
    },
  },
});

const baseDeps = (over: Partial<P8PassDeps>): P8PassDeps => ({
  queryCouncilRows: async () => [],
  enqueue: () => {},
  currentPriors: NEUTRAL,
  ...over,
});

describe("runP8CalibrateCore (injectable seam, synthetic inputs)", () => {
  it("fires on real signal: 5 'high' rows (1 approved / 4 rejected) → one recalibrate task naming high 0.5→0.3", async () => {
    const enq: SelfModTask[] = [];
    // approvalRate = 1/5 = 0.2; |0.2 − 0.5| = 0.3 ≥ deadband(0.05); bounded by step(0.2) → 0.5 → 0.3.
    const rows = [
      row("simulated_approved", "high"),
      row("rejected", "high"),
      row("rejected", "high"),
      row("rejected", "high"),
      row("rejected", "high"),
    ];

    const lines = await runP8CalibrateCore(
      baseDeps({
        queryCouncilRows: async () => rows,
        enqueue: (t) => enq.push(t),
      }),
    );

    // Enqueued exactly once, with the recalibrate class.
    assert.equal(enq.length, 1);
    assert.equal(enq[0].selfModClass, "recalibrate");

    // The description names the band move 0.5 → 0.3 for 'high' (decideCalibration's
    // "set <band>: <from> → <to>" line; arrow is U+2192, spacing-tolerant match).
    assert.match(enq[0].description, /set high:\s*0\.5\s*→\s*0\.3/);
    // ...and targets only the calibration file's literals.
    assert.match(enq[0].description, /src\/council\/council-calibration\.ts/);

    // The pass's own summary log names the move too (ASCII form: "high 0.5->0.3").
    assert.equal(lines.length, 1);
    assert.match(lines[0], /enqueued recalibrate/);
    assert.match(lines[0], /high 0\.5->0\.3/);
  });

  it("insufficient sample: 2 decided rows → no enqueue, result mentions insufficient sample", async () => {
    const enq: SelfModTask[] = [];
    const rows = [row("simulated_approved", "high"), row("rejected", "high")]; // 2 decided < minSample 4

    const lines = await runP8CalibrateCore(
      baseDeps({
        queryCouncilRows: async () => rows,
        enqueue: (t) => enq.push(t),
      }),
    );

    assert.equal(enq.length, 0);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /insufficient sample/);
  });

  it("within deadband: 4 'high' rows at exactly 0.5 approval → no enqueue", async () => {
    const enq: SelfModTask[] = [];
    // approvalRate = 2/4 = 0.5; |0.5 − 0.5| = 0 < deadband(0.05) → no move.
    const rows = [
      row("simulated_approved", "high"),
      row("simulated_approved", "high"),
      row("rejected", "high"),
      row("rejected", "high"),
    ];

    const lines = await runP8CalibrateCore(
      baseDeps({
        queryCouncilRows: async () => rows,
        enqueue: (t) => enq.push(t),
      }),
    );

    assert.equal(enq.length, 0);
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes("deadband") || lines[0].includes("no-op"));
  });
});
