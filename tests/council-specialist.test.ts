import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeLlmSpecialist, makeBrainSpecialist } from "../src/council/specialist.js";

describe("specialist runners", () => {
  it("LLM specialist returns a parsed finding", async () => {
    const infer = async () => JSON.stringify({ summary: "feasible", confidence: "medium", risks: [] });
    const s = makeLlmSpecialist("cto", infer);
    const f = await s.run({ goal: "build CRM" });
    assert.equal(f.specialistId, "cto");
    assert.equal(f.degraded, false);
  });
  it("infer throws → degraded finding, never throws", async () => {
    const s = makeLlmSpecialist("cto", async () => { throw new Error("boom"); });
    const f = await s.run({ goal: "x" });
    assert.equal(f.degraded, true);
  });
  it("infer times out → degraded finding", async () => {
    const slow = () => new Promise<string>((res) => setTimeout(() => res("{}"), 50));
    const s = makeLlmSpecialist("cto", slow, 5); // 5ms timeout
    const f = await s.run({ goal: "x" });
    assert.equal(f.degraded, true);
  });
  it("brain specialist adapts an injected brain result", async () => {
    const s = makeBrainSpecialist("research", "prior-art", async () => ({ summary: "found 3 refs", confidence: "high", risks: [] }));
    const f = await s.run({ goal: "x" });
    assert.equal(f.summary, "found 3 refs");
    assert.equal(f.degraded, false);
  });
  it("brain that throws → degraded, never throws", async () => {
    const s = makeBrainSpecialist("research", "prior-art", async () => { throw new Error("nope"); });
    const f = await s.run({ goal: "x" });
    assert.equal(f.degraded, true);
  });
  it("brain result with degraded:true → specialist finding is degraded:true", async () => {
    // The brain explicitly signals it ran lightweight (no real sources).
    const s = makeBrainSpecialist("research", "prior-art", async () => ({
      summary: "no sources gathered — lightweight",
      confidence: "low",
      risks: ["Unknown: sub-question 1"],
      degraded: true,
    }));
    const f = await s.run({ goal: "build something" });
    assert.equal(f.degraded, true, "brain returning degraded:true must produce a degraded specialist finding");
    assert.equal(f.confidence, "low");
  });
  it("brain result with degraded:false → specialist finding is degraded:false", async () => {
    // The brain signals it ran with real sources (full-gather).
    const s = makeBrainSpecialist("research", "prior-art", async () => ({
      summary: "found real sources about the topic",
      confidence: "medium",
      risks: [],
      degraded: false,
    }));
    const f = await s.run({ goal: "build something" });
    assert.equal(f.degraded, false, "brain returning degraded:false must produce a non-degraded specialist finding");
    assert.equal(f.confidence, "medium");
  });
  it("brain result without degraded field → defaults to degraded:false (backward compat)", async () => {
    // Older brains that don't return degraded field still work: defaults to false.
    const s = makeBrainSpecialist("research", "prior-art", async () => ({
      summary: "found 3 refs",
      confidence: "high",
      risks: [],
      // degraded field absent
    }));
    const f = await s.run({ goal: "x" });
    assert.equal(f.degraded, false, "absent degraded field must default to false");
  });
});
