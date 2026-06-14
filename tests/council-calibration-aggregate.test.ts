// tests/council-calibration-aggregate.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateCalibration,
  type CouncilRunRecord,
} from "../src/learning/council-calibration-aggregate.js";

const r = (confidence: "low" | "medium" | "high", decision: "approved" | "rejected" | "pending"): CouncilRunRecord =>
  ({ confidence, decision });

describe("aggregateCalibration", () => {
  it("empty input → all bands neutral 0.5, zero decided", () => {
    const a = aggregateCalibration([]);
    assert.equal(a.totalDecided, 0);
    for (const band of ["low", "medium", "high"] as const) {
      assert.equal(a.byBand[band].decided, 0);
      assert.equal(a.byBand[band].approved, 0);
      assert.equal(a.byBand[band].approvalRate, 0.5);
    }
  });

  it("pending runs are EXCLUDED from decided + rate", () => {
    const a = aggregateCalibration([r("high", "approved"), r("high", "pending"), r("high", "pending")]);
    assert.equal(a.byBand.high.decided, 1);
    assert.equal(a.byBand.high.approved, 1);
    assert.equal(a.byBand.high.approvalRate, 1);
    assert.equal(a.totalDecided, 1);
  });

  it("computes per-band approval rate over decided runs", () => {
    const a = aggregateCalibration([
      r("high", "approved"), r("high", "rejected"), r("high", "rejected"), r("high", "rejected"), // 1/4 = 0.25
      r("medium", "approved"), r("medium", "approved"), r("medium", "rejected"),                  // 2/3 ≈ 0.6667
    ]);
    assert.equal(a.byBand.high.decided, 4);
    assert.equal(a.byBand.high.approvalRate, 0.25);
    assert.equal(a.byBand.medium.decided, 3);
    assert.ok(Math.abs(a.byBand.medium.approvalRate - 2 / 3) < 1e-9);
    assert.equal(a.byBand.low.decided, 0);
    assert.equal(a.byBand.low.approvalRate, 0.5); // untouched neutral
    assert.equal(a.totalDecided, 7);
  });

  it("never throws on a malformed record (defensive)", () => {
    // @ts-expect-error intentionally malformed
    const a = aggregateCalibration([{ confidence: "bogus", decision: "approved" }, null, undefined]);
    assert.ok(a.totalDecided >= 0);
  });
});
