// tests/council-calibration-decide.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decideCalibration,
  DEFAULT_TUNING,
} from "../src/learning/council-calibration-decide.js";
import type { CalibrationAggregate, BandStat } from "../src/learning/council-calibration-aggregate.js";
import type { Confidence } from "../src/council/council-types.js";

const NEUTRAL: Record<Confidence, number> = { low: 0.5, medium: 0.5, high: 0.5 };

const agg = (over: Partial<Record<Confidence, Partial<BandStat>>>): CalibrationAggregate => {
  const band = (b: Confidence): BandStat => ({
    band: b, decided: 0, approved: 0, approvalRate: 0.5,
    ...(over[b] ?? {}),
  });
  const byBand = { low: band("low"), medium: band("medium"), high: band("high") };
  const totalDecided = byBand.low.decided + byBand.medium.decided + byBand.high.decided;
  return { byBand, totalDecided };
};

describe("DEFAULT_TUNING (Responsive)", () => {
  it("is minSample 4 / deadband 0.05 / step 0.20", () => {
    assert.deepEqual(DEFAULT_TUNING, { minSample: 4, deadband: 0.05, step: 0.2 });
  });
});

describe("decideCalibration", () => {
  it("no-ops a band below minSample even with a big gap", () => {
    const d = decideCalibration(NEUTRAL, agg({ high: { decided: 3, approved: 0, approvalRate: 0 } }), DEFAULT_TUNING);
    assert.deepEqual(d.deltas, []);
    assert.equal(d.description, null);
  });

  it("no-ops a band inside the deadband", () => {
    const d = decideCalibration(NEUTRAL, agg({ high: { decided: 10, approved: 5, approvalRate: 0.52 } }), DEFAULT_TUNING);
    assert.deepEqual(d.deltas, []);
    assert.equal(d.description, null);
  });

  it("moves toward observed, bounded by step, when sample + deadband clear", () => {
    // observed 0.0, current 0.5, gap 0.5 > deadband; step 0.2 → 0.30
    const d = decideCalibration(NEUTRAL, agg({ high: { decided: 8, approved: 0, approvalRate: 0 } }), DEFAULT_TUNING);
    assert.equal(d.deltas.length, 1);
    assert.equal(d.deltas[0].band, "high");
    assert.equal(d.deltas[0].from, 0.5);
    assert.equal(d.deltas[0].to, 0.3);
    assert.ok(d.description && d.description.includes("council-calibration.ts"));
    assert.ok(d.description!.includes("high: 0.5"));
    assert.ok(d.description!.includes("0.3"));
  });

  it("moves UP toward a high observed rate too (prior tracks reality, not demote-only)", () => {
    // observed 1.0, current 0.5, step 0.2 → 0.70
    const d = decideCalibration(NEUTRAL, agg({ medium: { decided: 6, approved: 6, approvalRate: 1 } }), DEFAULT_TUNING);
    assert.equal(d.deltas[0].band, "medium");
    assert.equal(d.deltas[0].to, 0.7);
  });

  it("when the gap is smaller than step, lands exactly on observed (2dp)", () => {
    // observed 0.4, current 0.5, gap 0.1 < step 0.2 → 0.40
    const d = decideCalibration(NEUTRAL, agg({ high: { decided: 5, approved: 2, approvalRate: 0.4 } }), DEFAULT_TUNING);
    assert.equal(d.deltas[0].to, 0.4);
  });

  it("emits multiple band deltas in one description, others left untouched", () => {
    const d = decideCalibration(
      NEUTRAL,
      agg({
        high: { decided: 8, approved: 0, approvalRate: 0 },
        medium: { decided: 8, approved: 8, approvalRate: 1 },
      }),
      DEFAULT_TUNING,
    );
    assert.equal(d.deltas.length, 2);
    assert.ok(d.description!.includes("high"));
    assert.ok(d.description!.includes("medium"));
    assert.ok(!d.description!.includes("low:")); // unchanged band not mentioned
  });

  it("never throws on a degenerate aggregate", () => {
    // @ts-expect-error degenerate
    const d = decideCalibration(NEUTRAL, { byBand: {}, totalDecided: 0 }, DEFAULT_TUNING);
    assert.deepEqual(d.deltas, []);
  });
});
