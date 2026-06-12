/**
 * tests/rollback-proposal.test.ts — P4: generate a rollback PROPOSAL from an executed mutation.
 *
 * Creating a rollback is itself just a proposal (rollback_pending_approval) — it mutates NOTHING;
 * Hart still approves it, and the host runner + every execution floor still decide whether the undo
 * runs. The generator carries the original's link + move facts in the payload so the host can
 * reconstruct the inverse. Only an executed, invertible mutation (clickup-move) yields a rollback.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rollbackProposalFor } from "../src/execution/rollback-proposal.js";
import { ADAPTER_ROUTE_KEY } from "../src/cockpit/suggestions/suggestion-to-mutation.js";
import type { ProposalQueueItem } from "../src/cockpit/proposals/proposal-types.js";

const NOW = new Date("2026-06-12T15:00:00.000Z");

function executedMove(over: Partial<ProposalQueueItem> = {}): ProposalQueueItem {
  return {
    id: "p-move-1", domain: "ops", actionType: "ops_followup_plan",
    title: 'Move "Acme" in progress → on hold', description: "d", sourceIntent: "mutate",
    proposedPayload: { [ADAPTER_ROUTE_KEY]: { adapterId: "clickup-move-status", tier: "T3" }, cardId: "86a", cardName: "Acme", fromStatus: "in progress", toStatus: "on hold" },
    expectedEffect: "e", riskLevel: "medium", requiredApproval: "Hart",
    expiresAt: null, safetyNotes: [], blockedReason: "", dryRunResult: null, executable: false,
    tier: "T3", targetId: "86a", createdAt: "2026-06-12T14:00:00.000Z",
    status: "executed", updatedAt: "2026-06-12T14:00:00.000Z", auditEvents: [],
    ...over,
  } as ProposalQueueItem;
}

describe("rollbackProposalFor — generate a rollback proposal from an executed move", () => {
  it("creates a rollback_pending_approval proposal linking the original + carrying the move facts", () => {
    const rb = rollbackProposalFor(executedMove(), NOW);
    assert.ok(rb);
    assert.equal(rb!.status, "rollback_pending_approval");
    assert.equal(rb!.proposedPayload.rollbackOf, "p-move-1");
    // carries the move facts so the host can reconstruct the inverse
    assert.equal(rb!.proposedPayload.cardId, "86a");
    assert.equal(rb!.proposedPayload.fromStatus, "in progress");
    assert.equal(rb!.proposedPayload.toStatus, "on hold");
    // routes to the same adapter (the inverse is a forward move in reverse)
    const route = rb!.proposedPayload[ADAPTER_ROUTE_KEY] as { adapterId?: string };
    assert.equal(route.adapterId, "clickup-move-status");
    assert.equal(rb!.createdAt, NOW.toISOString());
    assert.equal(rb!.executable, false, "still a non-executable proposal — Hart approves it");
  });

  it("uses a deterministic id (one rollback per original) so re-requests don't duplicate", () => {
    assert.equal(rollbackProposalFor(executedMove(), NOW)!.id, rollbackProposalFor(executedMove(), NOW)!.id);
    assert.match(rollbackProposalFor(executedMove(), NOW)!.id, /p-move-1/);
  });

  it("returns null for a NON-invertible original (e.g. a clickup-comment)", () => {
    const comment = executedMove({ proposedPayload: { [ADAPTER_ROUTE_KEY]: { adapterId: "clickup-comment", tier: "T3" }, cardId: "86a", cardName: "Acme", commentText: "x" } });
    assert.equal(rollbackProposalFor(comment, NOW), null);
  });

  it("returns null when the original is not executed (nothing landed to undo)", () => {
    assert.equal(rollbackProposalFor(executedMove({ status: "approved_for_execution" }), NOW), null);
  });

  it("returns null when the move facts are incomplete", () => {
    const bad = executedMove({ proposedPayload: { [ADAPTER_ROUTE_KEY]: { adapterId: "clickup-move-status", tier: "T3" }, cardId: "86a" } });
    assert.equal(rollbackProposalFor(bad, NOW), null);
  });
});
