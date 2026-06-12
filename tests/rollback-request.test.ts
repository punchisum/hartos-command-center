/**
 * tests/rollback-request.test.ts — P4: assemble a RollbackExecuteInput from an executed move.
 *
 * The host holds the original executed proposal's move facts (card + from/to, from its payload), a
 * fresh live re-read of the card, and whether the original was confirmed landed (P3 audit). This
 * pure bridge turns those into the originalCommand + the reconstructed (landed) originalOutcome +
 * the rollback-gate facts the executor needs. Reconstructing before/after from from/to is valid
 * ONLY because the original was verified landed — so the card now sits at `toStatus`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rollbackInputForExecutedMove } from "../src/execution/rollback-request.js";

const STORE = {} as never;
const base = {
  cardId: "86a", cardName: "Acme", fromStatus: "in progress", toStatus: "on hold",
  proposalRef: { id: "p-orig", status: "executed" as const, expiresAt: null },
  store: STORE,
  originalLandedConfirmed: true,
  rollbackApproved: true,
  hasCapabilityToken: true,
  actionAllowlisted: true,
  rollbackExpiresAt: null,
};

describe("rollbackInputForExecutedMove — bridge from an executed move to a rollback request", () => {
  it("reconstructs the original command + landed outcome (before=from, after=to)", () => {
    const out = rollbackInputForExecutedMove({ ...base, liveStatus: "on hold" });
    assert.equal(out.originalCommand.adapterId, "clickup-move-status");
    if (out.originalCommand.adapterId === "clickup-move-status") {
      assert.equal(out.originalCommand.target.fromStatus, "in progress");
      assert.equal(out.originalCommand.target.toStatus, "on hold");
    }
    assert.equal(out.originalOutcome.ran, true);
    assert.equal(out.originalOutcome.reversible, true);
    assert.deepEqual(out.originalOutcome.before, { status: "in progress" });
    assert.deepEqual(out.originalOutcome.after, { status: "on hold" });
  });

  it("sets liveMatchesOriginalOutcome true when the live card still sits at the original toStatus", () => {
    const out = rollbackInputForExecutedMove({ ...base, liveStatus: "on hold" });
    assert.equal(out.gate.liveMatchesOriginalOutcome, true);
  });

  it("sets liveMatchesOriginalOutcome FALSE when the card diverged (someone moved it since)", () => {
    const out = rollbackInputForExecutedMove({ ...base, liveStatus: "in review" });
    assert.equal(out.gate.liveMatchesOriginalOutcome, false);
  });

  it("sets liveMatchesOriginalOutcome FALSE when the live re-read failed (null) — fail closed", () => {
    const out = rollbackInputForExecutedMove({ ...base, liveStatus: null });
    assert.equal(out.gate.liveMatchesOriginalOutcome, false);
  });

  it("forwards the host-computed gate facts (approved / landed / token / allowlisted)", () => {
    const out = rollbackInputForExecutedMove({ ...base, liveStatus: "on hold", originalLandedConfirmed: false, actionAllowlisted: false });
    assert.equal(out.gate.rollbackApproved, true);
    assert.equal(out.gate.originalExecutionConfirmed, false);
    assert.equal(out.gate.hasCapabilityToken, true);
    assert.equal(out.gate.actionAllowlisted, false);
    assert.equal(out.gate.auditEntryWritten, true, "the host writes the rollback attempt audit before calling");
  });
});
