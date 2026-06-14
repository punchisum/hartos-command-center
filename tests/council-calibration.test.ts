// tests/council-calibration.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COUNCIL_BAND_APPROVAL,
  COUNCIL_DEMOTE_BELOW,
  calibrateConfidence,
} from "../src/council/council-calibration.js";

describe("calibrateConfidence (demote-only)", () => {
  it("seeded priors are neutral 0.5 for all three bands", () => {
    assert.equal(COUNCIL_BAND_APPROVAL.low, 0.5);
    assert.equal(COUNCIL_BAND_APPROVAL.medium, 0.5);
    assert.equal(COUNCIL_BAND_APPROVAL.high, 0.5);
    assert.equal(COUNCIL_DEMOTE_BELOW, 0.5);
  });

  it("at neutral priors (0.5, not below the floor) nothing is demoted", () => {
    assert.equal(calibrateConfidence("high"), "high");
    assert.equal(calibrateConfidence("medium"), "medium");
    assert.equal(calibrateConfidence("low"), "low");
  });

  it("a band whose prior is BELOW the floor is demoted exactly one step", () => {
    assert.equal(calibrateConfidence("high", { low: 0.5, medium: 0.5, high: 0.4 }), "medium");
    assert.equal(calibrateConfidence("medium", { low: 0.5, medium: 0.4, high: 0.5 }), "low");
  });

  it("low never demotes below low (floor)", () => {
    assert.equal(calibrateConfidence("low", { low: 0.1, medium: 0.5, high: 0.5 }), "low");
  });

  it("NEVER inflates: a high prior on a low band does not promote it (§19 preserved)", () => {
    assert.equal(calibrateConfidence("low", { low: 0.99, medium: 0.99, high: 0.99 }), "low");
    assert.equal(calibrateConfidence("medium", { low: 0.99, medium: 0.99, high: 0.99 }), "medium");
  });

  it("only demotes ONE step even with a very low prior", () => {
    assert.equal(calibrateConfidence("high", { low: 0.5, medium: 0.5, high: 0.01 }), "medium");
  });
});
