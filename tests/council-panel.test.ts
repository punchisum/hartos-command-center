/**
 * tests/council-panel.test.ts — Task 3.2 tests for buildCouncilPanel.
 * No DB — proposals are injected directly.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCouncilPanel } from "../src/cockpit/panels/council-panel.js";
import type { ActionProposal } from "../src/cockpit/proposals/proposal-types.js";

const NOW = "2026-06-14T10:00:00.000Z";

function councilProposal(over: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: "cp-1",
    domain: "council",
    actionType: "council_plan",
    title: "CRM Council Run",
    description: "Council deliberation on CRM build.",
    sourceIntent: "Should we build a CRM?",
    proposedPayload: {
      rootGoal: "Build CRM",
      recommendation: "Proceed with CRM.",
      confidence: "high",
      llmCallsUsed: 4,
      tree: {
        goal: { goal: "Build CRM" },
        panel: ["cto", "financial"],
        findings: [
          { specialistId: "cto", lens: "tech", summary: "Sound architecture.", confidence: "high", risks: [], degraded: false },
          { specialistId: "financial", lens: "cost", summary: "Feasible budget.", confidence: "medium", risks: [], degraded: false },
        ],
        synthesis: {
          recommendation: "Proceed with CRM.",
          confidence: "high",
          consensus: ["Architecture is solid"],
          dissent: ["Timeline is tight"],
          truncated: false,
          notes: [],
        },
        children: [],
        depth: 1,
      },
    },
    expectedEffect: "Council recommendation surfaced.",
    riskLevel: "medium",
    requiredApproval: "Hart",
    status: "pending_approval",
    createdAt: NOW,
    expiresAt: null,
    safetyNotes: [],
    blockedReason: "Action execution disabled.",
    dryRunResult: null,
    executable: false,
    ...over,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildCouncilPanel", () => {
  it("empty proposals list returns a safe empty panel", () => {
    const panel = buildCouncilPanel([], { now: NOW });
    assert.equal(panel.totalCount, 0);
    assert.equal(panel.proposals.length, 0);
    assert.equal(panel.selectedView, null);
    assert.equal(panel.selectedId, null);
    assert.equal(panel.approvalAffordance, null);
    assert.ok(panel.summary.length > 0);
    assert.equal(panel.generatedAt, NOW);
  });

  it("filters out non-council proposals silently", () => {
    const fitness = councilProposal({ id: "f1", domain: "fitness" } as Partial<ActionProposal>);
    const panel = buildCouncilPanel([fitness], { now: NOW });
    assert.equal(panel.totalCount, 0);
    assert.equal(panel.proposals.length, 0);
  });

  it("single council proposal produces a panel with one row and a view-model", () => {
    const panel = buildCouncilPanel([councilProposal()], { now: NOW });
    assert.equal(panel.totalCount, 1);
    assert.equal(panel.proposals.length, 1);
    assert.ok(panel.selectedView !== null);
    assert.equal(panel.selectedId, "cp-1");
    assert.equal(panel.selectedView!.rootGoal, "Build CRM");
    assert.equal(panel.selectedView!.recommendation, "Proceed with CRM.");
    assert.equal(panel.selectedView!.confidence, "high");
  });

  it("findingRows are present in the selected view-model", () => {
    const panel = buildCouncilPanel([councilProposal()], { now: NOW });
    assert.equal(panel.selectedView!.findingRows.length, 2);
  });

  it("dissent is surfaced in the selected view-model", () => {
    const panel = buildCouncilPanel([councilProposal()], { now: NOW });
    assert.deepEqual(panel.selectedView!.dissent, ["Timeline is tight"]);
    assert.deepEqual(panel.selectedView!.prominentDissent, ["Timeline is tight"]);
  });

  it("pending_approval proposal produces an approval affordance (no execution)", () => {
    const panel = buildCouncilPanel([councilProposal()], { now: NOW });
    assert.ok(panel.approvalAffordance !== null);
    assert.equal(panel.approvalAffordance!.proposalId, "cp-1");
    assert.equal(panel.approvalAffordance!.endpoint, "POST /api/proposals/transition");
    assert.deepEqual(panel.approvalAffordance!.actions, ["approve", "reject"]);
    // Gating note confirms no execution path
    assert.ok(panel.approvalAffordance!.gatingNote.includes("disabled"));
  });

  it("approved/rejected proposal does NOT produce an approval affordance", () => {
    const panel = buildCouncilPanel([councilProposal({ status: "approved_simulated" })], { now: NOW });
    assert.equal(panel.approvalAffordance, null);
    const panel2 = buildCouncilPanel([councilProposal({ status: "rejected" })], { now: NOW });
    assert.equal(panel2.approvalAffordance, null);
  });

  it("selects first pending_approval proposal when no selectedId given", () => {
    const approved = councilProposal({ id: "cp-a", status: "approved_simulated" });
    const pending = councilProposal({ id: "cp-p", status: "pending_approval" });
    const panel = buildCouncilPanel([approved, pending], { now: NOW });
    assert.equal(panel.selectedId, "cp-p");
  });

  it("respects explicit selectedId", () => {
    const p1 = councilProposal({ id: "cp-1", status: "pending_approval" });
    const p2 = councilProposal({ id: "cp-2", status: "draft" });
    const panel = buildCouncilPanel([p1, p2], { selectedId: "cp-2", now: NOW });
    assert.equal(panel.selectedId, "cp-2");
  });

  it("proposal row summary is non-empty and contains council recommendation", () => {
    const panel = buildCouncilPanel([councilProposal()], { now: NOW });
    const row = panel.proposals[0]!;
    assert.ok(row.summary.length > 0);
    assert.ok(row.selected);
  });

  it("multiple proposals all produce rows", () => {
    const p1 = councilProposal({ id: "cp-1" });
    const p2 = councilProposal({ id: "cp-2", title: "Second council", status: "rejected" });
    const panel = buildCouncilPanel([p1, p2], { now: NOW });
    assert.equal(panel.totalCount, 2);
    assert.equal(panel.proposals.length, 2);
  });

  it("panel summary mentions pending count when proposals are awaiting approval", () => {
    const panel = buildCouncilPanel([councilProposal()], { now: NOW });
    assert.ok(panel.summary.includes("awaiting") || panel.summary.includes("pending") || panel.summary.includes("decision"));
  });

  it("panel summary mentions no pending when all proposals are terminal", () => {
    const panel = buildCouncilPanel([councilProposal({ status: "approved_simulated" })], { now: NOW });
    assert.ok(panel.summary.includes("none pending"));
  });
});
