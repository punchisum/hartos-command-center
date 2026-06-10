/**
 * tests/beezulbub-llm-assessment.test.ts — LLM-deepened capability due-diligence (injected, no net).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCapabilityAssessor, assessTopCandidates } from "../src/beezulbub/llm-assessment.js";
import type { ScoutCandidate } from "../src/beezulbub/types.js";

function cand(name: string, value: number): ScoutCandidate {
  return { name, targetCapability: "markdown_editor", reason: "r", estimatedValue: value, staleRisk: "low", notes: "" };
}

describe("buildCapabilityAssessor (injected infer, no network)", () => {
  it("returns a named assessment when a real model answers", async () => {
    const assess = buildCapabilityAssessor({}, async () => ({ content: "Maintained; MIT; fit good. Lean: DEVOUR.", model: "gpt-5.5" }));
    const a = await assess(cand("milkdown", 9));
    assert.equal(a?.name, "milkdown");
    assert.match(a!.assessment, /DEVOUR/);
  });

  it("returns null when no real model answered (honesty floor)", async () => {
    const assess = buildCapabilityAssessor({}, async () => null);
    assert.equal(await assess(cand("x", 5)), null);
  });
});

describe("assessTopCandidates", () => {
  it("assesses the top-N by value and omits nulls (never a fabricated assessment)", async () => {
    const candidates = [cand("low", 3), cand("high", 9), cand("mid", 6)];
    // Only "high" gets a real answer; the others return null.
    const assess = async (c: ScoutCandidate) =>
      c.name === "high" ? { name: c.name, assessment: "great" } : null;
    const out = await assessTopCandidates(candidates, assess, 2); // top 2 = high, mid
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "high");
  });
});
