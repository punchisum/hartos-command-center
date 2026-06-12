/**
 * tests/inverse-command.test.ts — P4: derive the INVERSE mutation that undoes an executed one.
 *
 * (Distinct from tests/rollback-plan.test.ts, which covers INFRA rollback — wrangler / migration
 * ledger / webhook. This is the proposal-mutation rollback subsystem.)
 *
 * Rolling back a reversible external mutation is just the FORWARD adapter run in the opposite
 * direction — so rollback can ride the SAME gated dispatch path rather than a parallel one. This
 * pure function turns an executed command + its outcome into the inverse command, but ONLY when the
 * undo is itself safe: the original actually ran + was reversible, and (for a ClickUp move) the
 * REVERSE transition is also on the approved allowlist. Otherwise it reports why it is irreversible.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inverseCommandFor } from "../src/execution/inverse-command.js";
import type { MutationCommand } from "../src/execution/execution-dispatch.js";
import type { ExecutionOutcome } from "../src/execution/execution-adapter.js";

const PROPOSAL = { id: "p-orig", status: "executed" as const, expiresAt: null };
const STORE = {} as never;

function move(fromStatus: string, toStatus: string): MutationCommand {
  return { adapterId: "clickup-move-status", proposal: PROPOSAL, target: { cardId: "86a", cardName: "Acme", fromStatus, toStatus }, store: STORE };
}

function ranOutcome(before: string, after: string, reversible = true): ExecutionOutcome {
  return { ran: true, reversible, before: { status: before }, after: { status: after }, summary: "moved" };
}

describe("inverseCommandFor — the undo of an executed mutation", () => {
  it("inverts a reversible ClickUp move whose reverse transition is also approved", () => {
    // forward: in progress → on hold ; reverse: on hold → in progress (both approved)
    const res = inverseCommandFor(move("in progress", "on hold"), ranOutcome("in progress", "on hold"));
    assert.equal(res.reversible, true);
    if (!res.reversible) return;
    assert.equal(res.command.adapterId, "clickup-move-status");
    if (res.command.adapterId === "clickup-move-status") {
      assert.equal(res.command.target.fromStatus, "on hold", "undo starts from where the card now is");
      assert.equal(res.command.target.toStatus, "in progress", "undo returns it to the original status");
      assert.equal(res.command.target.cardId, "86a");
    }
  });

  it("refuses when the reverse transition is NOT approved (forward-only move)", () => {
    // forward: waiting on hart → in progress ; reverse in progress → waiting on hart is NOT approved
    const res = inverseCommandFor(move("waiting on hart", "in progress"), ranOutcome("waiting on hart", "in progress"));
    assert.equal(res.reversible, false);
    if (!res.reversible) assert.match(res.reason, /not approved/i);
  });

  it("refuses to invert a mutation that never ran (noop / refusal)", () => {
    const noop: ExecutionOutcome = { ran: false, reversible: true, before: { status: "in progress" }, after: { status: "in progress" }, summary: "no-op" };
    const res = inverseCommandFor(move("in progress", "on hold"), noop);
    assert.equal(res.reversible, false);
    if (!res.reversible) assert.match(res.reason, /did not run|nothing to undo/i);
  });

  it("refuses to invert an outcome explicitly marked irreversible", () => {
    const res = inverseCommandFor(move("in progress", "on hold"), ranOutcome("in progress", "on hold", false));
    assert.equal(res.reversible, false);
  });

  it("reports no automatic inverse for adapters without one yet (e.g. clickup-comment)", () => {
    const comment: MutationCommand = { adapterId: "clickup-comment", proposal: PROPOSAL, target: { cardId: "86a", cardName: "Acme", commentText: "noted" }, store: STORE };
    const res = inverseCommandFor(comment, { ran: true, reversible: true, before: {}, after: { comments: 1 }, summary: "posted" });
    assert.equal(res.reversible, false);
    if (!res.reversible) assert.match(res.reason, /no automatic inverse|not.*yet/i);
  });
});
