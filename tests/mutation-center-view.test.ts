/**
 * tests/mutation-center-view.test.ts
 *
 * Phase 16 — the PURE hosted-cockpit Mutation Center view-builder (`mutationCenterView`),
 * which wraps the already-shipped `buildMutationCenterModel` and adds the `available`
 * honesty branch the hosted views use (mirroring `proposalsView`).
 *
 * Hermetic: no env, no network, no fs, no Supabase, no ambient clock. The CockpitState is
 * hand-built and `now` is a literal — the view itself reads no clock. Proves: a present
 * queue with a pending-executable proposal ⇒ available + rows + executable "disabled"; an
 * absent queue ⇒ available:false + an honest note (no fabricated rows); a present-but-non-
 * executable queue ⇒ available + zero rows + an honest "empty ≠ nothing approved" note.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mutationCenterView } from "../src/runtime/views/mutation-center-view.js";
import type { CockpitState } from "../src/cockpit/cockpit-types.js";
import type {
  DryRunResult,
  ProposalQueueItem,
} from "../src/cockpit/proposals/proposal-types.js";

const NOW = "2026-06-09T12:00:00.000Z";

function dryRun(): DryRunResult {
  return {
    wouldHappen: "Would approve proposal p1 for execution (no real effect).",
    dataWouldTouch: ["cockpit-proposals/p1.json"],
    approvalRequired: "Hart",
    executionDisabledReason: "execution is disabled in this plane",
    futureSetupRequired: ["arm the adapter allowlist flag"],
    executed: false,
  };
}

/** Build a ProposalQueueItem fixture — a COMPLETE T1 payload by default. Overrides win. */
function item(over: Partial<ProposalQueueItem> = {}): ProposalQueueItem {
  const base: ProposalQueueItem = {
    id: "p1",
    domain: "system",
    actionType: "review_plan",
    title: "Approve refresh-sync for execution",
    description: "Approve the proposal for execution (Key 1).",
    sourceIntent: "approve for execution",
    proposedPayload: {},
    expectedEffect: "proposal becomes approved_for_execution",
    riskLevel: "low",
    requiredApproval: "Hart",
    createdAt: NOW,
    expiresAt: null,
    safetyNotes: [],
    blockedReason: "execution is gated off-Worker",
    dryRunResult: dryRun(),
    executable: false,
    tier: "T1",
    targetId: "target-p1",
    targetName: "Refresh-sync proposal",
    idempotencyKey: "idem-p1",
    rollbackOrCorrectionNote: "revoke execution approval to undo",
    status: "approved_for_execution",
    updatedAt: NOW,
    auditEvents: [{ at: NOW, event: "approved_for_execution" }],
  };
  return { ...base, ...over };
}

/** Hand-built CockpitState carrying just the proposal queue the view reads. */
function stateWith(proposalQueue: ProposalQueueItem[] | undefined): CockpitState | undefined {
  if (proposalQueue === undefined) return undefined;
  return { generatedAt: NOW, proposalQueue } as unknown as CockpitState;
}

describe("mutationCenterView — present queue with a pending-executable row", () => {
  it("available:true, spreads the model, rows present, executable 'disabled'", () => {
    const view = mutationCenterView(stateWith([item()]));
    assert.equal(view.available, true);
    if (!view.available) return; // narrow for TS
    assert.equal(view.executable, "disabled");
    assert.equal(view.origin, "local");
    assert.equal(view.mode, "read_only_snapshot");
    assert.equal(view.total, 1);
    assert.equal(view.pending, 1);
    assert.equal(view.rows.length, 1);
    const row = view.rows[0]!;
    assert.equal(row.id, "p1");
    assert.equal(row.status, "approved_for_execution");
    assert.equal(row.executable, "disabled");
    assert.deepEqual(row.target, { id: "target-p1", name: "Refresh-sync proposal" });
    assert.deepEqual(row.refusedActions, []);
    assert.equal(row.payloadComplete, true);
  });

  it("a simulated_approved row is also surfaced as pending-executable", () => {
    const view = mutationCenterView(stateWith([item({ id: "p-sim", status: "simulated_approved" })]));
    assert.equal(view.available, true);
    if (!view.available) return;
    assert.equal(view.pending, 1);
    assert.equal(view.rows[0]!.status, "simulated_approved");
  });

  it("is deterministic for the same snapshot", () => {
    const state = stateWith([item()]);
    assert.deepEqual(mutationCenterView(state), mutationCenterView(state));
  });
});

describe("mutationCenterView — absent queue (honest unavailable branch)", () => {
  it("undefined state ⇒ available:false + honest note + no fabricated rows", () => {
    const view = mutationCenterView(undefined);
    assert.equal(view.available, false);
    if (view.available) return;
    assert.equal(view.executable, "disabled");
    assert.equal(view.origin, "local");
    assert.equal(view.mode, "local_only");
    assert.equal(view.total, 0);
    assert.equal(view.pending, 0);
    assert.deepEqual(view.rows, []);
    assert.match(view.note, /unavailable|local-only/i);
  });

  it("a state with no proposalQueue ⇒ available:false (mirrors proposalsView)", () => {
    const view = mutationCenterView({ generatedAt: NOW } as unknown as CockpitState);
    assert.equal(view.available, false);
    if (view.available) return;
    assert.deepEqual(view.rows, []);
  });
});

describe("mutationCenterView — present-but-non-executable queue (honest empty-state)", () => {
  it("a queue with only non-executable items ⇒ available:true, zero rows, honest note", () => {
    const view = mutationCenterView(
      stateWith([
        item({ id: "p-draft", status: "draft" }),
        item({ id: "p-executed", status: "executed" }),
        item({ id: "p-rejected", status: "rejected" }),
      ]),
    );
    assert.equal(view.available, true);
    if (!view.available) return;
    assert.equal(view.total, 3);
    assert.equal(view.pending, 0);
    assert.deepEqual(view.rows, []);
    // empty ≠ "nothing approved": the note must say so honestly.
    assert.match(view.note, /does NOT mean nothing is approved|clamps/i);
  });

  it("an empty queue ⇒ available:true with zero rows and the honest empty-state note", () => {
    const view = mutationCenterView(stateWith([]));
    assert.equal(view.available, true);
    if (!view.available) return;
    assert.equal(view.total, 0);
    assert.equal(view.pending, 0);
    assert.deepEqual(view.rows, []);
    assert.match(view.note, /No rows are pending-executable|approved/i);
  });
});

describe("mutationCenterView — read-only invariants", () => {
  it("the serialized view carries NO execute/fetch/POST token (not an execution surface)", () => {
    const blob = JSON.stringify(mutationCenterView(stateWith([item(), item({ id: "p2", status: "simulated_approved" })])));
    assert.equal(/(?<!non-)execute(?!d)/i.test(blob), false);
    assert.equal(/fetch/i.test(blob), false);
    assert.equal(/POST/i.test(blob), false);
  });

  it("executable is 'disabled' on the view AND every row, in every branch", () => {
    const present = mutationCenterView(stateWith([item()]));
    assert.equal(present.executable, "disabled");
    if (present.available) for (const r of present.rows) assert.equal(r.executable, "disabled");
    const absent = mutationCenterView(undefined);
    assert.equal(absent.executable, "disabled");
  });
});
