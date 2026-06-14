import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONFIDENCE_BANDS, isConfidence, type SpecialistFinding } from "../src/council/council-types.js";

describe("council-types", () => {
  it("confidence bands are ordered low<medium<high", () => {
    assert.deepEqual(CONFIDENCE_BANDS, ["low", "medium", "high"]);
  });
  it("isConfidence guards the band union", () => {
    assert.equal(isConfidence("high"), true);
    assert.equal(isConfidence("certain"), false);
  });
  it("a SpecialistFinding carries lens, summary, confidence, risks", () => {
    const f: SpecialistFinding = { specialistId: "cto", lens: "feasibility", summary: "buildable in ~6w", confidence: "medium", risks: ["auth scope"], degraded: false };
    assert.equal(f.confidence, "medium");
  });
});
