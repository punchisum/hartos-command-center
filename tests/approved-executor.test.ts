/**
 * tests/approved-executor.test.ts
 *
 * "Approve → it moves, no CLI." Proves the host executor reconstructs a gated command from an
 * APPROVED proposal and dispatches it — and refuses everything else (not approved, no route,
 * incomplete payload, unwired adapter). The dispatcher is faked so no real write occurs; the
 * point is that the executor adds NO authority and only acts on approved proposals.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { commandFromApprovedProposal, executeApprovedProposals } from "../src/execution/approved-executor.js";
import { ADAPTER_ROUTE_KEY } from "../src/cockpit/suggestions/suggestion-to-mutation.js";
import { EXECUTABLE_FROM } from "../src/doctrine/execution-gate.js";
import type { ProposalQueueItem } from "../src/cockpit/proposals/proposal-types.js";
import type { DispatchResult } from "../src/execution/execution-dispatch.js";

const NOW = new Date("2026-06-09T12:00:00.000Z");
const fakeClickUp = {} as never; // never actually called — dispatch is faked

function moveProposal(over: Partial<ProposalQueueItem> = {}): ProposalQueueItem {
  return {
    id: "p-move", domain: "ops", actionType: "ops_followup_plan",
    title: 'Move "Acme" → on hold', description: "d", sourceIntent: "mutate",
    proposedPayload: { [ADAPTER_ROUTE_KEY]: { adapterId: "clickup-move-status", tier: "T3" }, cardId: "86a", cardName: "Acme", fromStatus: "in progress", toStatus: "on hold" },
    expectedEffect: "e", riskLevel: "medium", requiredApproval: "Hart",
    expiresAt: null, safetyNotes: [], blockedReason: "", dryRunResult: null, executable: false,
    tier: "T3", targetId: "86a", createdAt: "2026-06-09T11:00:00.000Z",
    status: EXECUTABLE_FROM, updatedAt: NOW.toISOString(), auditEvents: [],
    ...over,
  } as ProposalQueueItem;
}

describe("commandFromApprovedProposal", () => {
  it("reconstructs a clickup-move command from an approved proposal", () => {
    const built = commandFromApprovedProposal(moveProposal(), { clickUp: fakeClickUp });
    assert.ok(!("skip" in built));
    if ("skip" in built) return;
    assert.equal(built.adapterId, "clickup-move-status");
    assert.equal(built.proposal.id, "p-move");
    assert.equal(built.proposal.status, EXECUTABLE_FROM);
    if (built.adapterId === "clickup-move-status") {
      assert.deepEqual(built.target, { cardId: "86a", cardName: "Acme", fromStatus: "in progress", toStatus: "on hold" });
    }
  });

  it("skips a proposal that is NOT approved_for_execution", () => {
    const built = commandFromApprovedProposal(moveProposal({ status: "pending_approval" }), { clickUp: fakeClickUp });
    assert.ok("skip" in built && /not "approved_for_execution"/.test(built.skip));
  });

  it("skips when the adapter route is missing", () => {
    const built = commandFromApprovedProposal(moveProposal({ proposedPayload: {} }), { clickUp: fakeClickUp });
    assert.ok("skip" in built && /no mutationRoute/.test(built.skip));
  });

  it("skips when the move payload is incomplete", () => {
    const built = commandFromApprovedProposal(moveProposal({ proposedPayload: { [ADAPTER_ROUTE_KEY]: { adapterId: "clickup-move-status", tier: "T3" }, cardId: "86a" } }), { clickUp: fakeClickUp });
    assert.ok("skip" in built && /incomplete move payload/.test(built.skip));
  });

  it("skips when no ClickUp store is injected", () => {
    const built = commandFromApprovedProposal(moveProposal(), {});
    assert.ok("skip" in built && /no ClickUp store/.test(built.skip));
  });
});

describe("executeApprovedProposals", () => {
  function fakeDispatch(wrote: boolean): { fn: typeof dispatchStub; calls: () => number } {
    let calls = 0;
    const dispatchStub = async (): Promise<DispatchResult> => {
      calls += 1;
      return {
        adapterId: "clickup-move-status",
        result: { adapterId: "clickup-move-status", precondition: { allowed: wrote, denials: [] } as never, executed: wrote, outcome: { ran: wrote, reversible: true, before: {}, after: {}, summary: wrote ? "moved in progress → on hold" : "refused (flag off)" } as never },
        delta: wrote ? ({ kind: "state_delta" } as never) : null,
      };
    };
    return { fn: dispatchStub, calls: () => calls };
  }

  it("dispatches one approved proposal and reports the write", async () => {
    const d = fakeDispatch(true);
    const out = await executeApprovedProposals({ proposals: [moveProposal()], stores: { clickUp: fakeClickUp }, env: {}, dispatch: d.fn, now: NOW });
    assert.equal(out.executable, 1);
    assert.equal(out.executed, 1);
    assert.equal(out.results[0]!.outcome, "executed");
    assert.equal(out.results[0]!.wrote, true);
    assert.equal(d.calls(), 1);
  });

  it("honest no_write when the gate refuses (flag off) — dispatch called, nothing written", async () => {
    const d = fakeDispatch(false);
    const out = await executeApprovedProposals({ proposals: [moveProposal()], stores: { clickUp: fakeClickUp }, env: {}, dispatch: d.fn, now: NOW });
    assert.equal(out.executed, 0);
    assert.equal(out.results[0]!.outcome, "no_write");
    assert.equal(out.results[0]!.wrote, false);
  });

  it("never touches a proposal that isn't approved (no dispatch call)", async () => {
    const d = fakeDispatch(true);
    const out = await executeApprovedProposals({ proposals: [moveProposal({ status: "pending_approval" })], stores: { clickUp: fakeClickUp }, env: {}, dispatch: d.fn, now: NOW });
    assert.equal(out.executable, 0);
    assert.equal(d.calls(), 0, "no dispatch for an unapproved proposal");
  });

  it("respects max=1 — one card per pass even with several approved", async () => {
    const d = fakeDispatch(true);
    const out = await executeApprovedProposals({
      proposals: [moveProposal({ id: "a" }), moveProposal({ id: "b", createdAt: "2026-06-09T11:30:00.000Z" })],
      stores: { clickUp: fakeClickUp }, env: {}, dispatch: d.fn, now: NOW, max: 1,
    });
    assert.equal(out.executable, 2);
    assert.equal(out.executed, 1, "capped at one write");
    assert.equal(d.calls(), 1);
  });
});
