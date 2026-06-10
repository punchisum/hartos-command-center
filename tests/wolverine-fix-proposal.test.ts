/**
 * tests/wolverine-fix-proposal.test.ts — Wolverine → gated FixProposal bridge.
 *
 * Proves: the proposal-hygiene detector produces fixable findings, the mapper turns them into
 * non-executable, tier-complete FixProposals routed to the right adapter, and advisory findings
 * map to null. The tier-completeness check means the executor (execute:approved) can run them.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { detectProposalHygiene } from "../src/wolverine/detectors/proposal-hygiene.js";
import { wolverineFixProposal, wolverineFixProposals } from "../src/wolverine/wolverine-fix-proposal.js";
import { ADAPTER_ROUTE_KEY } from "../src/cockpit/suggestions/suggestion-to-mutation.js";
import { assertTierPayloadComplete } from "../src/cockpit/proposals/proposal-tiering.js";
import type { WolverineFinding, WolverineInputs } from "../src/wolverine/wolverine-types.js";

const NOW = "2026-06-10T00:00:00.000Z";

describe("detectProposalHygiene", () => {
  it("produces a reject-drafts fix for aging drafts and archive for rejected", () => {
    const inputs: WolverineInputs = { now: NOW, proposalStats: { agingDraftCount: 3, rejectedCount: 2, agingHours: 72 } };
    const f = detectProposalHygiene(inputs);
    const drafts = f.find((x) => x.id === "proposal:aging-drafts");
    const rejected = f.find((x) => x.id === "proposal:rejected-to-archive");
    assert.equal(drafts?.fixRoute?.adapterId, "reject-drafts");
    assert.equal(drafts?.fixRoute?.tier, "T0");
    assert.equal(rejected?.fixRoute?.adapterId, "archive-rejected");
  });

  it("finds nothing without stats, or when counts are zero", () => {
    assert.equal(detectProposalHygiene({ now: NOW }).length, 0);
    assert.equal(detectProposalHygiene({ now: NOW, proposalStats: { agingDraftCount: 0, rejectedCount: 0 } }).length, 0);
  });
});

describe("wolverineFixProposal", () => {
  const fixable: WolverineFinding = {
    id: "proposal:aging-drafts",
    category: "improvement",
    severity: "medium",
    title: "3 aging draft proposals in the queue",
    evidence: "3 stale drafts.",
    ownerAgent: "HartOS proposal spine",
    recommendedFix: "Reject the 3 aging drafts.",
    blastRadius: "Internal queue only.",
    rollbackPath: "Restore to draft.",
    approvalRequired: true,
    confidence: "high",
    freshness: "now",
    source: "proposal-hygiene",
    fixRoute: { adapterId: "reject-drafts", tier: "T0" },
  };

  it("maps a fixRoute finding to a non-executable, routed FixProposal", () => {
    const p = wolverineFixProposal(fixable, NOW);
    assert.ok(p);
    assert.equal(p!.executable, false);
    assert.equal(p!.requiredApproval, "Hart");
    assert.equal(p!.status, "draft");
    assert.equal(p!.tier, "T0");
    assert.ok(p!.idempotencyKey && p!.idempotencyKey.length > 0);
    const route = p!.proposedPayload[ADAPTER_ROUTE_KEY] as { adapterId?: string };
    assert.equal(route.adapterId, "reject-drafts");
  });

  it("produces a TIER-COMPLETE proposal (executor-ready)", () => {
    const p = wolverineFixProposal(fixable, NOW)!;
    const check = assertTierPayloadComplete(p);
    assert.equal(check.allowed, true, `tier check failed: ${JSON.stringify(check)}`);
  });

  it("returns null for an advisory finding (no fixRoute)", () => {
    const advisory: WolverineFinding = { ...fixable, fixRoute: undefined };
    assert.equal(wolverineFixProposal(advisory, NOW), null);
  });

  it("batch maps + drops advisory findings", () => {
    const advisory: WolverineFinding = { ...fixable, id: "x", fixRoute: undefined };
    const out = wolverineFixProposals([fixable, advisory], NOW);
    assert.equal(out.length, 1);
  });
});
