/**
 * tests/rollback-executor.test.ts — P4: the rollback execution core.
 *
 * Mirrors approved-executor: a PURE core over an injected gated `dispatch`. It composes the
 * inverse-command derivation + the fail-closed rollback-gate, then (only if both pass) dispatches
 * the inverse through the SAME gated path the forward mutation used. The host computes the gate
 * booleans (original landed from the P3 audit; live-matches-outcome from a fresh re-read) + writes
 * the audit; this core never fetches. Adds no authority — every floor still holds.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { executeRollback, type RollbackGateFacts } from "../src/execution/rollback-executor.js";
import type { MutationCommand, DispatchResult } from "../src/execution/execution-dispatch.js";
import type { ExecutionOutcome } from "../src/execution/execution-adapter.js";

const NOW = new Date("2026-06-12T12:00:00.000Z");
const PROPOSAL = { id: "p-orig", status: "executed" as const, expiresAt: null };
const STORE = {} as never; // dispatch is faked, so the store is only carried, never read

function move(fromStatus: string, toStatus: string): MutationCommand {
  return { adapterId: "clickup-move-status", proposal: PROPOSAL, target: { cardId: "86a", cardName: "Acme", fromStatus, toStatus }, store: STORE };
}
function ranOutcome(before: string, after: string): ExecutionOutcome {
  return { ran: true, reversible: true, before: { status: before }, after: { status: after }, summary: "moved" };
}
/** Every gate fact satisfied — the happy baseline a test can selectively break. */
function allGood(): RollbackGateFacts {
  return { rollbackApproved: true, expiresAt: null, hasCapabilityToken: true, auditEntryWritten: true, originalExecutionConfirmed: true, liveMatchesOriginalOutcome: true, actionAllowlisted: true };
}

function captureDispatch(wrote = true) {
  const calls: MutationCommand[] = [];
  const fn = async (command: MutationCommand): Promise<DispatchResult> => {
    calls.push(command);
    return {
      adapterId: command.adapterId,
      result: { adapterId: command.adapterId, precondition: { allowed: true, denials: [] }, executed: wrote, outcome: { ran: wrote, reversible: true, before: {}, after: {}, summary: wrote ? "moved back" : "no write" } },
      delta: wrote ? ({ source: command.adapterId } as unknown as DispatchResult["delta"]) : null,
      verification: wrote ? { landed: true, detail: "undo landed" } : null,
    };
  };
  return { calls, fn };
}

describe("executeRollback — gated inverse dispatch", () => {
  it("rolls back a reversible move: dispatches the INVERSE through the gated path", async () => {
    const { calls, fn } = captureDispatch(true);
    const res = await executeRollback({
      originalCommand: move("in progress", "on hold"), originalOutcome: ranOutcome("in progress", "on hold"),
      gate: allGood(), env: {}, dispatch: fn, now: NOW,
    });
    assert.equal(res.outcome, "rolled_back");
    assert.equal(res.wrote, true);
    assert.equal(calls.length, 1, "the inverse was dispatched exactly once");
    const inv = calls[0]!;
    assert.equal(inv.adapterId, "clickup-move-status");
    if (inv.adapterId === "clickup-move-status") {
      assert.equal(inv.target.fromStatus, "on hold");
      assert.equal(inv.target.toStatus, "in progress");
    }
  });

  it("refuses an irreversible original WITHOUT dispatching (forward-only move)", async () => {
    const { calls, fn } = captureDispatch(true);
    const res = await executeRollback({
      originalCommand: move("waiting on hart", "in progress"), originalOutcome: ranOutcome("waiting on hart", "in progress"),
      gate: allGood(), env: {}, dispatch: fn, now: NOW,
    });
    assert.equal(res.outcome, "irreversible");
    assert.equal(res.wrote, false);
    assert.equal(calls.length, 0, "nothing is dispatched for an irreversible mutation");
  });

  it("refuses (no dispatch) when the live target diverged from the original outcome", async () => {
    const { calls, fn } = captureDispatch(true);
    const res = await executeRollback({
      originalCommand: move("in progress", "on hold"), originalOutcome: ranOutcome("in progress", "on hold"),
      gate: { ...allGood(), liveMatchesOriginalOutcome: false }, env: {}, dispatch: fn, now: NOW,
    });
    assert.equal(res.outcome, "refused");
    assert.equal(calls.length, 0);
    assert.match(res.detail, /diverged|later change/i);
  });

  it("refuses (no dispatch) when the original execution was never confirmed to have landed", async () => {
    const { calls, fn } = captureDispatch(true);
    const res = await executeRollback({
      originalCommand: move("in progress", "on hold"), originalOutcome: ranOutcome("in progress", "on hold"),
      gate: { ...allGood(), originalExecutionConfirmed: false }, env: {}, dispatch: fn, now: NOW,
    });
    assert.equal(res.outcome, "refused");
    assert.equal(calls.length, 0);
    assert.match(res.detail, /never happened|not confirmed/i);
  });

  it("reports no_write when the inverse passes the gate but the inner dispatch did not write (flag OFF / noop)", async () => {
    const { calls, fn } = captureDispatch(false);
    const res = await executeRollback({
      originalCommand: move("in progress", "on hold"), originalOutcome: ranOutcome("in progress", "on hold"),
      gate: allGood(), env: {}, dispatch: fn, now: NOW,
    });
    assert.equal(calls.length, 1, "the gate allowed it, so the inverse was attempted");
    assert.equal(res.outcome, "no_write");
    assert.equal(res.wrote, false);
  });
});
