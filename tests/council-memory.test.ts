/**
 * tests/council-memory.test.ts — Task 3.4 tests for councilRunMemoryEntry.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { councilRunMemoryEntry } from "../src/council/council-memory.js";
import type { CouncilProposalPayload } from "../src/council/council-types.js";

const AT = "2026-06-14T12:00:00.000Z";

function fullPayload(): CouncilProposalPayload {
  return {
    rootGoal: "Build CRM system",
    recommendation: "Proceed with phased CRM build.",
    confidence: "high",
    llmCallsUsed: 6,
    tree: {
      goal: { goal: "Build CRM system" },
      panel: ["cto", "financial", "ops"],
      findings: [
        { specialistId: "cto", lens: "tech", summary: "Architecture solid.", confidence: "high", risks: ["complexity"], degraded: false },
        { specialistId: "financial", lens: "cost", summary: "Budget feasible.", confidence: "medium", risks: [], degraded: false },
        { specialistId: "ops", lens: "operations", summary: "Ops ready.", confidence: "medium", risks: [], degraded: false },
      ],
      synthesis: {
        recommendation: "Proceed with phased CRM build.",
        confidence: "high",
        consensus: ["Architecture is solid", "Budget approved"],
        dissent: ["Timeline may slip", "Vendor risk unaddressed"],
        truncated: false,
        notes: [],
      },
      children: [],
      depth: 1,
    },
  };
}

describe("councilRunMemoryEntry", () => {
  it("approved run produces correct entry shape", () => {
    const entry = councilRunMemoryEntry(fullPayload(), "approved", AT);
    assert.equal(entry.at, AT);
    assert.equal(entry.goal, "Build CRM system");
    assert.deepEqual(entry.panel, ["cto", "financial", "ops"]);
    assert.equal(entry.recommendation, "Proceed with phased CRM build.");
    assert.equal(entry.confidence, "high");
    assert.equal(entry.activeFindingCount, 3);
    assert.equal(entry.degradedCount, 0);
    assert.equal(entry.dissentCount, 2);
    assert.equal(entry.truncated, false);
    assert.equal(entry.llmCallsUsed, 6);
    assert.equal(entry.hartDecision, "approved");
  });

  it("rejected run marks hartDecision as rejected", () => {
    const entry = councilRunMemoryEntry(fullPayload(), "rejected", AT);
    assert.equal(entry.hartDecision, "rejected");
    assert.equal(entry.learningSignal.hartDecision, "rejected");
  });

  it("pending run marks hartDecision as pending", () => {
    const entry = councilRunMemoryEntry(fullPayload(), "pending", AT);
    assert.equal(entry.hartDecision, "pending");
  });

  it("learning signal carries panelKey (sorted specialist ids), confidence, dissentCount, and decision", () => {
    const entry = councilRunMemoryEntry(fullPayload(), "approved", AT);
    // Panel is ["cto","financial","ops"] → sorted → "cto+financial+ops"
    assert.equal(entry.learningSignal.panelKey, "cto+financial+ops");
    assert.equal(entry.learningSignal.confidence, "high");
    assert.equal(entry.learningSignal.dissentCount, 2);
    assert.equal(entry.learningSignal.hartDecision, "approved");
  });

  it("memoryHints.riskSubjects carries dissent items for executive-memory pattern detection", () => {
    const entry = councilRunMemoryEntry(fullPayload(), "approved", AT);
    assert.deepEqual(entry.memoryHints.riskSubjects, ["Timeline may slip", "Vendor risk unaddressed"]);
  });

  it("memoryHints.opportunitySubjects carries consensus items", () => {
    const entry = councilRunMemoryEntry(fullPayload(), "approved", AT);
    assert.deepEqual(entry.memoryHints.opportunitySubjects, ["Architecture is solid", "Budget approved"]);
  });

  it("degraded findings are counted separately", () => {
    const payload = {
      ...fullPayload(),
      tree: {
        ...fullPayload().tree,
        findings: [
          ...fullPayload().tree.findings,
          { specialistId: "risk", lens: "risk", summary: "", confidence: "low" as const, risks: [], degraded: true },
        ],
      },
    };
    const entry = councilRunMemoryEntry(payload, "pending", AT);
    assert.equal(entry.activeFindingCount, 3);
    assert.equal(entry.degradedCount, 1);
  });

  it("truncated flag is captured from synthesis", () => {
    const payload = {
      ...fullPayload(),
      tree: {
        ...fullPayload().tree,
        synthesis: { ...fullPayload().tree.synthesis, truncated: true },
      },
    };
    const entry = councilRunMemoryEntry(payload, "pending", AT);
    assert.equal(entry.truncated, true);
  });

  it("null payload never throws — returns a safe degraded entry", () => {
    assert.doesNotThrow(() => {
      const entry = councilRunMemoryEntry(null, "pending", AT);
      assert.equal(entry.goal, "(unknown goal)");
      assert.equal(entry.confidence, "low");
      assert.equal(entry.hartDecision, "pending");
    });
  });

  it("undefined payload never throws — returns safe defaults", () => {
    assert.doesNotThrow(() => {
      const entry = councilRunMemoryEntry(undefined, "rejected", AT);
      assert.equal(entry.activeFindingCount, 0);
      assert.equal(entry.dissentCount, 0);
    });
  });

  it("malformed payload never throws", () => {
    assert.doesNotThrow(() => councilRunMemoryEntry("bad", "pending", AT));
    assert.doesNotThrow(() => councilRunMemoryEntry(42, "approved", AT));
    assert.doesNotThrow(() => councilRunMemoryEntry({ tree: "also bad" }, "rejected", AT));
  });

  it("approved vs rejected runs produce correctly-shaped entries for comparison", () => {
    const approved = councilRunMemoryEntry(fullPayload(), "approved", AT);
    const rejected = councilRunMemoryEntry(fullPayload(), "rejected", AT);
    // Same panel, goal, recommendation — only hartDecision and learningSignal.hartDecision differ.
    assert.equal(approved.learningSignal.panelKey, rejected.learningSignal.panelKey);
    assert.equal(approved.goal, rejected.goal);
    assert.notEqual(approved.hartDecision, rejected.hartDecision);
    assert.notEqual(approved.learningSignal.hartDecision, rejected.learningSignal.hartDecision);
  });
});
