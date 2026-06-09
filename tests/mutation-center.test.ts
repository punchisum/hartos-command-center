/**
 * tests/mutation-center.test.ts
 *
 * Slice F (master plan §12) — the PURE, read-only Mutation Center assembler.
 *
 * Hermetic: no env, no network, no fs, no Supabase, no ambient clock (`now` is a literal).
 * Proves the model includes ONLY pending-executable proposals, names refused actions from the
 * tier-payload precondition, and stays read-only — `executable: "disabled"` and the serialized
 * model carries no execute/fetch/POST token (it is not an execution surface).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildMutationCenterModel,
  PENDING_EXECUTABLE_STATUSES,
} from "../src/cockpit/mutation/mutation-center.js";
import type {
  DryRunResult,
  ProposalQueueItem,
  ProposalQueueStatus,
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

/** Build a ProposalQueueItem fixture. Overrides win over the complete-T1 defaults. */
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
    // ── Mutation-tiering fields — a COMPLETE T1 payload by default ──
    tier: "T1",
    targetId: "target-p1",
    targetName: "Refresh-sync proposal",
    idempotencyKey: "idem-p1",
    rollbackOrCorrectionNote: "revoke execution approval to undo",
    // ── Queue fields ──
    status: "approved_for_execution",
    updatedAt: NOW,
    auditEvents: [{ at: NOW, event: "approved_for_execution" }],
  };
  return { ...base, ...over };
}

describe("buildMutationCenterModel — pending-executable assembly", () => {
  it("a complete approved_for_execution T1 row ⇒ empty refusedActions + payloadComplete true", () => {
    const model = buildMutationCenterModel([item()]);
    assert.equal(model.pending, 1);
    assert.equal(model.rows.length, 1);
    const row = model.rows[0]!;
    assert.equal(row.id, "p1");
    assert.equal(row.tier, "T1");
    assert.equal(row.status, "approved_for_execution");
    assert.deepEqual(row.refusedActions, []);
    assert.equal(row.payloadComplete, true);
    assert.equal(row.executable, "disabled");
    assert.deepEqual(row.target, { id: "target-p1", name: "Refresh-sync proposal" });
    assert.equal(row.dryRun, "Would approve proposal p1 for execution (no real effect).");
    assert.equal(row.rollbackNote, "revoke execution approval to undo");
  });

  it("an untiered row ⇒ tier null + a 'no tier' refusal + payloadComplete false", () => {
    const model = buildMutationCenterModel([
      item({ id: "p-untiered", tier: undefined, status: "simulated_approved" }),
    ]);
    assert.equal(model.rows.length, 1);
    const row = model.rows[0]!;
    assert.equal(row.tier, null);
    assert.equal(row.payloadComplete, false);
    assert.equal(row.refusedActions.length >= 1, true);
    assert.equal(
      row.refusedActions.some((d) => /no tier/i.test(d)),
      true,
    );
  });

  it("falls back to the proposal id when targetId is absent, and name to null", () => {
    const model = buildMutationCenterModel([
      item({ id: "p-no-target", targetId: undefined, targetName: undefined }),
    ]);
    const row = model.rows[0]!;
    assert.equal(row.target.id, "p-no-target");
    assert.equal(row.target.name, null);
  });

  it("a missing dryRun renders dryRun null (never fabricated)", () => {
    const model = buildMutationCenterModel([item({ dryRunResult: null })]);
    assert.equal(model.rows[0]!.dryRun, null);
  });
});

describe("buildMutationCenterModel — exclusion rules", () => {
  const excluded: ProposalQueueStatus[] = [
    // executor-only states
    "executing",
    "executed",
    "execution_failed",
    "runtime_provisioned",
    // not pending-executable
    "draft",
    "pending_approval",
    "rejected",
    "expired",
  ];

  for (const status of excluded) {
    it(`excludes status="${status}" from the model`, () => {
      const model = buildMutationCenterModel([item({ id: `p-${status}`, status })]);
      assert.equal(model.pending, 0);
      assert.equal(model.rows.length, 0);
      // total still counts the input that was filtered out.
      assert.equal(model.total, 1);
    });
  }

  it("includes only the pending-executable subset from a mixed queue", () => {
    const model = buildMutationCenterModel([
      item({ id: "keep-1", status: "simulated_approved" }),
      item({ id: "keep-2", status: "approved_for_execution" }),
      item({ id: "drop-executing", status: "executing" }),
      item({ id: "drop-executed", status: "executed" }),
      item({ id: "drop-rejected", status: "rejected" }),
      item({ id: "drop-expired", status: "expired" }),
      item({ id: "drop-draft", status: "draft" }),
    ]);
    assert.equal(model.total, 7);
    assert.equal(model.pending, 2);
    assert.deepEqual(
      model.rows.map((r) => r.id).sort(),
      ["keep-1", "keep-2"],
    );
  });

  it("PENDING_EXECUTABLE_STATUSES is exactly the two cockpit-settable approved states", () => {
    assert.deepEqual([...PENDING_EXECUTABLE_STATUSES].sort(), [
      "approved_for_execution",
      "simulated_approved",
    ]);
  });
});

describe("buildMutationCenterModel — read-only invariants", () => {
  it("model.executable === 'disabled' and every row is disabled", () => {
    const model = buildMutationCenterModel([item(), item({ id: "p2", status: "simulated_approved" })]);
    assert.equal(model.executable, "disabled");
    for (const row of model.rows) assert.equal(row.executable, "disabled");
  });

  it("the serialized model carries NO execute/fetch/POST token (not an execution surface)", () => {
    const blob = JSON.stringify(
      buildMutationCenterModel([
        item(),
        item({ id: "p2", tier: undefined, status: "simulated_approved" }),
      ]),
    );
    assert.equal(/execute/i.test(blob), false);
    assert.equal(/fetch/i.test(blob), false);
    assert.equal(/POST/i.test(blob), false);
  });

  it("an empty queue yields an empty, read-only model", () => {
    const model = buildMutationCenterModel([]);
    assert.equal(model.total, 0);
    assert.equal(model.pending, 0);
    assert.deepEqual(model.rows, []);
    assert.equal(model.executable, "disabled");
  });
});
