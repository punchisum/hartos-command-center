/**
 * tests/council-calibration-aggregate.test.ts — Task 2 tests for aggregateCalibration.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateCalibration,
} from "../src/learning/council-calibration-aggregate.js";
import type { CouncilRunRecord } from "../src/learning/council-calibration-aggregate.js";

describe("aggregateCalibration", () => {
  it("zero decided runs → every band reports neutral 0.5", () => {
    const result = aggregateCalibration([]);
    assert.equal(result.totalDecided, 0);
    assert.equal(result.byBand.low.approvalRate, 0.5);
    assert.equal(result.byBand.medium.approvalRate, 0.5);
    assert.equal(result.byBand.high.approvalRate, 0.5);
  });

  it("pending records are excluded from decided count and do not affect approvalRate", () => {
    const records: CouncilRunRecord[] = [
      { confidence: "high", decision: "pending" },
      { confidence: "high", decision: "pending" },
      { confidence: "high", decision: "approved" },
    ];
    const result = aggregateCalibration(records);
    assert.equal(result.byBand.high.decided, 1);
    assert.equal(result.byBand.high.approved, 1);
    assert.equal(result.byBand.high.approvalRate, 1.0);
    assert.equal(result.totalDecided, 1);
  });

  it("correct approval rate across multiple bands with mixed decisions", () => {
    const records: CouncilRunRecord[] = [
      { confidence: "high", decision: "approved" },
      { confidence: "high", decision: "rejected" },
      { confidence: "medium", decision: "approved" },
      { confidence: "medium", decision: "approved" },
      { confidence: "medium", decision: "rejected" },
      { confidence: "low", decision: "rejected" },
    ];
    const result = aggregateCalibration(records);
    assert.equal(result.byBand.high.decided, 2);
    assert.equal(result.byBand.high.approved, 1);
    assert.equal(result.byBand.high.approvalRate, 0.5);
    assert.equal(result.byBand.medium.decided, 3);
    assert.equal(result.byBand.medium.approved, 2);
    assert.ok(Math.abs(result.byBand.medium.approvalRate - 2 / 3) < 0.0001);
    assert.equal(result.byBand.low.decided, 1);
    assert.equal(result.byBand.low.approved, 0);
    assert.equal(result.byBand.low.approvalRate, 0.0);
    assert.equal(result.totalDecided, 6);
  });

  it("never throws on malformed or empty input", () => {
    assert.doesNotThrow(() => aggregateCalibration([]));
    assert.doesNotThrow(() => aggregateCalibration([
      { confidence: "low", decision: "pending" },
      { confidence: "medium", decision: "pending" },
      { confidence: "high", decision: "pending" },
    ]));
  });
});
