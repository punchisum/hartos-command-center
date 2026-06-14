import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runCouncil, type CouncilPorts } from "../src/council/council-coordinator.js";

function ports(over: Partial<CouncilPorts> = {}): CouncilPorts {
  return {
    isArmed: () => true,
    selectPanel: () => ["cto", "financial"],
    runSpecialist: async (id) => ({ specialistId: id, lens: id, summary: id + " ok", confidence: "medium", risks: [], degraded: false }),
    caps: { maxPanel: 5, maxLlmCalls: 30 },
    ...over,
  };
}

describe("runCouncil", () => {
  it("disarmed → skip, no specialist run", async () => {
    let ran = 0;
    const r = await runCouncil({ goal: "x" }, ports({ isArmed: () => false, runSpecialist: async (id) => { ran++; return { specialistId: id, lens: id, summary: "", confidence: "low", risks: [], degraded: true }; } }));
    assert.equal(r.skipped, true);
    assert.equal(ran, 0);
    assert.equal(r.payload, undefined);
  });
  it("armed → builds a depth-1 CouncilProposalPayload", async () => {
    const r = await runCouncil({ goal: "build CRM" }, ports());
    assert.equal(r.skipped, false);
    assert.equal(r.payload?.tree.depth, 1);
    assert.equal(r.payload?.tree.findings.length, 2);
    assert.equal(r.payload?.rootGoal, "build CRM");
    assert.equal(r.payload?.llmCallsUsed, 2);
  });
  it("respects maxPanel (caps the convened set)", async () => {
    const r = await runCouncil({ goal: "x" }, ports({ selectPanel: () => ["a", "b", "c", "d"], caps: { maxPanel: 2, maxLlmCalls: 30 } }));
    assert.equal(r.payload?.tree.panel.length, 2);
  });
  it("respects maxLlmCalls (truncates + flags it)", async () => {
    const r = await runCouncil({ goal: "x" }, ports({ selectPanel: () => ["a", "b", "c"], caps: { maxPanel: 5, maxLlmCalls: 1 } }));
    assert.equal(r.payload?.tree.findings.length, 1);
    assert.equal(r.payload?.tree.synthesis.truncated, true);
  });
  it("a specialist that self-degrades does not break the run", async () => {
    const r = await runCouncil({ goal: "x" }, ports({ runSpecialist: async (id) => ({ specialistId: id, lens: id, summary: "", confidence: "low", risks: [], degraded: true }) }));
    assert.equal(r.skipped, false);
    assert.ok(r.payload);
  });
});
