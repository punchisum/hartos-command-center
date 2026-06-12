/**
 * tests/fitness-mutation-materialize.test.ts — P5: a polled pending mutation → a spine proposal.
 *
 * The fitness side (same DB) writes a deterministic pending mutation; the command-center poller
 * materialises each into a ProposalQueueItem that rides the gated spine. This pure layer pins the
 * cross-repo contract from the command-center side: the payload carries exactly what
 * commandFromApprovedProposal needs to reconstruct the fitness-mutation command, the route, and a
 * deterministic id (one proposal per state_date+band) so re-polling never duplicates.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pendingFitnessMutationToProposal, type PendingFitnessMutation } from "../src/fitness/fitness-mutation-materialize.js";
import { ADAPTER_ROUTE_KEY } from "../src/cockpit/suggestions/suggestion-to-mutation.js";

const NOW = new Date("2026-06-12T22:05:00.000Z");
const PENDING: PendingFitnessMutation = {
  stateDate: "2026-06-12",
  recoveryBand: "green",
  recoveryScore: 84,
  action: "as-planned",
  caloriePct: 10,
  reason: "Green recovery — proceed as planned; fuel the load.",
  idempotencyKey: "2026-06-12:fitness-adjust:green",
};

describe("pendingFitnessMutationToProposal", () => {
  it("materialises a fitness ProposalQueueItem routed to the fitness-mutation adapter", () => {
    const p = pendingFitnessMutationToProposal(PENDING, NOW);
    assert.equal(p.domain, "fitness");
    assert.equal(p.actionType, "fitness_adjustment_plan");
    assert.equal(p.tier, "T1");
    assert.equal(p.status, "pending_approval");
    assert.equal(p.requiredApproval, "Hart");
    assert.equal(p.executable, false);
    const route = p.proposedPayload[ADAPTER_ROUTE_KEY] as { adapterId?: string };
    assert.equal(route.adapterId, "fitness-mutation");
  });

  it("carries the exact facts the executor needs to reconstruct the command", () => {
    const p = pendingFitnessMutationToProposal(PENDING, NOW);
    assert.equal(p.proposedPayload.stateDate, "2026-06-12");
    assert.equal(p.proposedPayload.recoveryBand, "green");
    assert.equal(p.proposedPayload.action, "as-planned");
    assert.equal(p.proposedPayload.caloriePct, 10);
    assert.equal(p.proposedPayload.reason, PENDING.reason);
    assert.equal(p.createdAt, NOW.toISOString());
  });

  it("uses a deterministic id (one proposal per state_date+band) so re-polling never duplicates", () => {
    assert.equal(pendingFitnessMutationToProposal(PENDING, NOW).id, pendingFitnessMutationToProposal(PENDING, NOW).id);
    assert.match(pendingFitnessMutationToProposal(PENDING, NOW).id, /2026-06-12/);
    assert.match(pendingFitnessMutationToProposal(PENDING, NOW).id, /green/);
    // a different band ⇒ a different proposal id
    assert.notEqual(
      pendingFitnessMutationToProposal(PENDING, NOW).id,
      pendingFitnessMutationToProposal({ ...PENDING, recoveryBand: "amber" }, NOW).id,
    );
  });

  it("clamps the reason to a safe length (never unbounded LLM text in the payload)", () => {
    const long = "x".repeat(500);
    const p = pendingFitnessMutationToProposal({ ...PENDING, reason: long }, NOW);
    assert.ok((p.proposedPayload.reason as string).length <= 300, "reason is capped at 300 chars");
  });
});
