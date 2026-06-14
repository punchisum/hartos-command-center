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
});
