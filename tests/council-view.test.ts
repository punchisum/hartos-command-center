/**
 * tests/council-view.test.ts — Task 3.1 tests for councilViewModel.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { councilViewModel, councilViewSummary } from "../src/cockpit/council-view.js";
import type { CouncilProposalPayload } from "../src/cockpit/council-view.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function fullPayload(): CouncilProposalPayload {
  return {
    rootGoal: "Build CRM council",
    recommendation: "Proceed with the CRM build.",
    confidence: "high",
    llmCallsUsed: 5,
    tree: {
      goal: { goal: "Build CRM council", context: "Q3 priority" },
      panel: ["cto", "financial", "ops"],
      findings: [
        { specialistId: "cto", lens: "technical", summary: "Architecture is sound.", confidence: "high", risks: ["vendor lock-in"], degraded: false },
        { specialistId: "financial", lens: "cost", summary: "Budget is feasible.", confidence: "medium", risks: [], degraded: false },
        { specialistId: "ops", lens: "operations", summary: "Ops overhead is manageable.", confidence: "medium", risks: ["onboarding time"], degraded: false },
      ],
      synthesis: {
        recommendation: "Proceed with the CRM build.",
        confidence: "high",
        consensus: ["Architecture is solid", "Budget is feasible"],
        dissent: ["Ops overhead needs monitoring"],
        truncated: false,
        notes: ["Unanimous on technical approach."],
      },
      children: [],
      depth: 1,
    },
  };
}

function degradedPayload(): CouncilProposalPayload {
  return {
    rootGoal: "Assess marketing",
    recommendation: "Insufficient data.",
    confidence: "low",
    llmCallsUsed: 1,
    tree: {
      goal: { goal: "Assess marketing" },
      panel: ["marketing"],
      findings: [
        { specialistId: "marketing", lens: "brand", summary: "", confidence: "low", risks: [], degraded: true },
      ],
      synthesis: {
        recommendation: "Insufficient data.",
        confidence: "low",
        consensus: [],
        dissent: [],
        truncated: true,
        notes: [],
      },
      children: [],
      depth: 1,
    },
  };
}

function payloadWithChildren(): CouncilProposalPayload {
  const child: CouncilProposalPayload["tree"] = {
    goal: { goal: "Sub-goal: pricing model" },
    panel: ["financial"],
    findings: [
      { specialistId: "financial", lens: "cost", summary: "Pricing is competitive.", confidence: "high", risks: [], degraded: false },
    ],
    synthesis: {
      recommendation: "Adopt tiered pricing.",
      confidence: "high",
      consensus: ["Tiered pricing wins"],
      dissent: [],
      truncated: false,
      notes: [],
    },
    children: [],
    depth: 2,
  };
  return {
    ...fullPayload(),
    tree: { ...fullPayload().tree, children: [child] },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("councilViewModel", () => {
  it("renders all parts of a full payload", () => {
    const view = councilViewModel(fullPayload());
    assert.equal(view.degraded, false);
    assert.equal(view.rootGoal, "Build CRM council");
    assert.equal(view.recommendation, "Proceed with the CRM build.");
    assert.equal(view.confidence, "high");
    assert.equal(view.llmCallsUsed, 5);
    assert.equal(view.findingRows.length, 3);
    assert.deepEqual(view.consensus, ["Architecture is solid", "Budget is feasible"]);
    assert.equal(view.notes.length, 1);
  });

  it("surfaces dissent prominently", () => {
    const view = councilViewModel(fullPayload());
    assert.equal(view.dissent.length, 1);
    assert.equal(view.dissent[0], "Ops overhead needs monitoring");
    assert.deepEqual(view.dissent, view.prominentDissent);
  });

  it("maps finding rows with all fields", () => {
    const view = councilViewModel(fullPayload());
    const cto = view.findingRows.find((r) => r.specialistId === "cto");
    assert.ok(cto);
    assert.equal(cto.lens, "technical");
    assert.equal(cto.confidence, "high");
    assert.equal(cto.degraded, false);
  });

  it("marks degraded specialist correctly", () => {
    const view = councilViewModel(degradedPayload());
    const row = view.findingRows[0];
    assert.ok(row);
    assert.equal(row.degraded, true);
  });

  it("degraded/truncated payload renders safely (no throw)", () => {
    const view = councilViewModel(degradedPayload());
    assert.equal(view.degraded, false); // payload is structurally valid but degraded finding
    assert.equal(view.truncated, true);
    // A truncation note should be injected since synthesis.notes was empty
    assert.ok(view.notes.some((n) => /truncat/i.test(n)));
  });

  it("null/undefined payload returns a safe empty view without throwing", () => {
    const v1 = councilViewModel(null);
    assert.equal(v1.degraded, true);
    assert.equal(v1.findingRows.length, 0);
    const v2 = councilViewModel(undefined);
    assert.equal(v2.degraded, true);
  });

  it("empty object payload returns a safe (non-throwing) view with empty fields", () => {
    const view = councilViewModel({});
    // Not marked degraded — the object is structurally valid; defaults fill in.
    // What matters: it never throws and produces empty-but-consistent fields.
    assert.equal(view.findingRows.length, 0);
    assert.equal(view.consensus.length, 0);
    assert.equal(view.dissent.length, 0);
    assert.equal(view.subCouncils.length, 0);
  });

  it("completely malformed payload never throws", () => {
    assert.doesNotThrow(() => councilViewModel("not an object"));
    assert.doesNotThrow(() => councilViewModel(42));
    assert.doesNotThrow(() => councilViewModel({ tree: "bad", rootGoal: 99 }));
  });

  it("includes nested sub-council summaries when children are present", () => {
    const view = councilViewModel(payloadWithChildren());
    assert.equal(view.subCouncils.length, 1);
    assert.equal(view.subCouncils[0]!.goal, "Sub-goal: pricing model");
    assert.equal(view.subCouncils[0]!.recommendation, "Adopt tiered pricing.");
    assert.equal(view.subCouncils[0]!.confidence, "high");
    assert.equal(view.subCouncils[0]!.findingCount, 1);
    assert.equal(view.subCouncils[0]!.depth, 2);
  });

  it("zero-children payload yields empty subCouncils", () => {
    const view = councilViewModel(fullPayload());
    assert.equal(view.subCouncils.length, 0);
  });
});

describe("councilViewSummary", () => {
  it("includes recommendation, confidence and dissent count when dissent is present", () => {
    const view = councilViewModel(fullPayload());
    const summary = councilViewSummary(view);
    assert.ok(summary.includes("Proceed with the CRM build."));
    assert.ok(summary.includes("high"));
    assert.ok(summary.includes("1 dissent"));
  });

  it("omits dissent note when there is no dissent", () => {
    const payload = { ...fullPayload(), tree: { ...fullPayload().tree, synthesis: { ...fullPayload().tree.synthesis, dissent: [] } } };
    const view = councilViewModel(payload);
    const summary = councilViewSummary(view);
    assert.ok(!summary.includes("dissent"));
  });

  it("degraded view returns a safe fallback summary", () => {
    const summary = councilViewSummary(councilViewModel(null));
    assert.ok(summary.includes("no data available"));
  });
});
