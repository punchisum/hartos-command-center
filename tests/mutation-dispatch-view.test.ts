/**
 * tests/mutation-dispatch-view.test.ts
 *
 * The PURE hosted-cockpit mutation-dispatch-readiness view-builder (`mutationDispatchView`),
 * which bridges the read-only Mutation Center to the gated `mutate` CLI: for each pending-
 * executable proposal it names the dispatcher adapter, computes dispatch-readiness, and renders a
 * COPYABLE DRY-RUN `npm run mutate` command. Mirrors `mutation-center-view.test.ts`.
 *
 * Hermetic: no env, no network, no fs, no Supabase, no ambient clock. The CockpitState is hand-
 * built and `now` is a literal — the view reads no clock. Proves: a present queue with a routed
 * pending-executable proposal ⇒ available + a row naming that adapter + a correct dry-run command
 * (with `--adapter` and `--proposal <id>`, and NO `--execute`); a proposal with no resolvable
 * adapter ⇒ adapterId null + dispatchReady false + mutateCommand null + an honest reason; an absent
 * queue ⇒ available:false + honest note (no fabricated rows); executable "disabled" on view + every
 * row; the serialized view carries no `--execute` / secret; determinism.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mutationDispatchView } from "../src/runtime/views/mutation-dispatch-view.js";
import type { CockpitState } from "../src/cockpit/cockpit-types.js";
import type {
  DryRunResult,
  ProposalQueueItem,
} from "../src/cockpit/proposals/proposal-types.js";

const NOW = "2026-06-09T12:00:00.000Z";

function dryRun(): DryRunResult {
  return {
    wouldHappen: "Would post one comment (no real effect).",
    dataWouldTouch: ["clickup:card:CARD-1"],
    approvalRequired: "Hart",
    executionDisabledReason: "execution is disabled in this plane",
    futureSetupRequired: ["arm the adapter allowlist flag"],
    executed: false,
  };
}

/**
 * A COMPLETE T0 internal-cleanup proposal that carries a `mutationRoute` adapter, approved for
 * execution. Overrides win. T0 requires no dry-run / before/after (REQUIRED_PAYLOAD_BY_TIER.T0),
 * so this passes the tier-payload check and is dispatch-ready by default.
 */
function item(over: Partial<ProposalQueueItem> = {}): ProposalQueueItem {
  const base: ProposalQueueItem = {
    id: "p1",
    domain: "system",
    actionType: "sync_repair_plan",
    title: "Reject aging draft proposals",
    description: "Reject the draft cohort.",
    sourceIntent: "suggestion:triage",
    proposedPayload: { mutationRoute: { adapterId: "reject-drafts", tier: "T0" } },
    expectedEffect: "draft proposals rejected",
    riskLevel: "low",
    requiredApproval: "Hart",
    createdAt: NOW,
    expiresAt: null,
    safetyNotes: [],
    blockedReason: "execution is gated off-Worker",
    dryRunResult: null,
    executable: false,
    tier: "T0",
    targetId: "cohort:proposals:status=draft",
    targetName: "Aging draft proposals",
    idempotencyKey: "idem-p1",
    rollbackOrCorrectionNote: "restore status to draft to undo",
    status: "approved_for_execution",
    updatedAt: NOW,
    auditEvents: [{ at: NOW, event: "approved_for_execution" }],
  };
  return { ...base, ...over };
}

/** A COMPLETE T3 ClickUp-comment proposal (route + card target + commentText), approved. */
function clickUpItem(over: Partial<ProposalQueueItem> = {}): ProposalQueueItem {
  return item({
    id: "p-cu",
    domain: "ops",
    actionType: "ops_followup_plan",
    title: "Comment on ClickUp card",
    riskLevel: "medium",
    tier: "T3",
    proposedPayload: {
      mutationRoute: { adapterId: "clickup-comment", tier: "T3" },
      commentText: "Nudge: please confirm scope by EOD.",
    },
    dryRunResult: dryRun(),
    targetId: "CARD-1",
    targetName: "Onboarding flow card",
    beforeState: { status: "in progress", commentCountKnown: false },
    afterState: { status: "in progress", commentAdded: true },
    idempotencyKey: "idem-cu",
    rollbackOrCorrectionNote: "post a correcting comment if wrong",
    ...over,
  });
}

/** Hand-built CockpitState carrying just the proposal queue the view reads. */
function stateWith(proposalQueue: ProposalQueueItem[] | undefined): CockpitState | undefined {
  if (proposalQueue === undefined) return undefined;
  return { generatedAt: NOW, proposalQueue } as unknown as CockpitState;
}

describe("mutationDispatchView — present queue with a routed, ready proposal", () => {
  it("available:true, names the adapter, dispatchReady, renders a dry-run command", () => {
    const view = mutationDispatchView(stateWith([item()]));
    assert.equal(view.available, true);
    if (!view.available) return; // narrow for TS
    assert.equal(view.executable, "disabled");
    assert.equal(view.origin, "local");
    assert.equal(view.mode, "read_only_snapshot");
    assert.equal(view.total, 1);
    assert.equal(view.ready, 1);
    assert.equal(view.rows.length, 1);

    const row = view.rows[0]!;
    assert.equal(row.id, "p1");
    assert.equal(row.status, "approved_for_execution");
    assert.equal(row.executable, "disabled");
    assert.equal(row.tier, "T0");
    assert.deepEqual(row.target, { id: "cohort:proposals:status=draft", name: "Aging draft proposals" });
    assert.equal(row.payloadComplete, true);
    assert.equal(row.adapterId, "reject-drafts");
    assert.equal(row.dispatchReady, true);
    assert.deepEqual(row.notReadyReasons, []);

    // The copyable DRY-RUN command: names the adapter + proposal, and NEVER --execute.
    assert.equal(typeof row.mutateCommand, "string");
    const cmd = row.mutateCommand!;
    assert.match(cmd, /--adapter reject-drafts/);
    assert.match(cmd, /--proposal 'p1'/);
    assert.match(cmd, /npm run mutate --/);
    assert.equal(/--execute/.test(cmd), false);
  });

  it("a ClickUp-comment proposal renders --card and --text from the target/payload (no --execute)", () => {
    const view = mutationDispatchView(stateWith([clickUpItem()]));
    assert.equal(view.available, true);
    if (!view.available) return;
    const row = view.rows[0]!;
    assert.equal(row.adapterId, "clickup-comment");
    assert.equal(row.dispatchReady, true);
    const cmd = row.mutateCommand!;
    assert.match(cmd, /--adapter clickup-comment/);
    assert.match(cmd, /--proposal 'p-cu'/);
    assert.match(cmd, /--card 'CARD-1'/);
    assert.match(cmd, /--text '.*confirm scope.*'/);
    assert.equal(/--execute/.test(cmd), false);
  });

  it("a clickup-move-status proposal renders --from/--to from before/after state", () => {
    const view = mutationDispatchView(
      stateWith([
        clickUpItem({
          id: "p-mv",
          title: "Move ClickUp card to done",
          proposedPayload: { mutationRoute: { adapterId: "clickup-move-status", tier: "T3" } },
          beforeState: { status: "in progress" },
          afterState: { status: "done" },
        }),
      ]),
    );
    assert.equal(view.available, true);
    if (!view.available) return;
    const cmd = view.rows[0]!.mutateCommand!;
    assert.match(cmd, /--adapter clickup-move-status/);
    assert.match(cmd, /--card 'CARD-1'/);
    assert.match(cmd, /--from 'in progress'/);
    assert.match(cmd, /--to 'done'/);
    assert.equal(/--execute/.test(cmd), false);
  });

  it("a simulated_approved row is surfaced but NOT dispatch-ready (Key 1 not granted)", () => {
    const view = mutationDispatchView(stateWith([item({ id: "p-sim", status: "simulated_approved" })]));
    assert.equal(view.available, true);
    if (!view.available) return;
    assert.equal(view.total, 1);
    assert.equal(view.ready, 0);
    const row = view.rows[0]!;
    assert.equal(row.status, "simulated_approved");
    assert.equal(row.adapterId, "reject-drafts");
    assert.equal(row.dispatchReady, false);
    // The reason names the missing Key-1 status, honestly.
    assert.ok(row.notReadyReasons.some((r) => /approved_for_execution/.test(r)));
    // A command is still rendered (the adapter resolved) — it is just not yet ready to fire.
    assert.equal(typeof row.mutateCommand, "string");
    assert.equal(/--execute/.test(row.mutateCommand!), false);
  });

  it("is deterministic for the same snapshot", () => {
    const state = stateWith([item(), clickUpItem()]);
    assert.deepEqual(mutationDispatchView(state), mutationDispatchView(state));
  });
});

describe("mutationDispatchView — a proposal with no resolvable adapter (null, no guess)", () => {
  it("adapterId null, dispatchReady false, mutateCommand null, a reason given", () => {
    const view = mutationDispatchView(
      stateWith([
        item({
          id: "p-noroute",
          // No mutationRoute in the payload → no route; the heuristic resolves nothing (no guess).
          proposedPayload: {},
        }),
      ]),
    );
    assert.equal(view.available, true);
    if (!view.available) return;
    assert.equal(view.ready, 0);
    const row = view.rows[0]!;
    assert.equal(row.adapterId, null);
    assert.equal(row.dispatchReady, false);
    assert.equal(row.mutateCommand, null);
    assert.ok(row.notReadyReasons.length >= 1);
    assert.ok(row.notReadyReasons.some((r) => /adapter|route/i.test(r)));
  });

  it("a malformed mutationRoute (unknown adapter id) resolves to null, not a guess", () => {
    const view = mutationDispatchView(
      stateWith([
        item({
          id: "p-bad",
          proposedPayload: { mutationRoute: { adapterId: "not-a-real-adapter", tier: "T0" } },
        }),
      ]),
    );
    assert.equal(view.available, true);
    if (!view.available) return;
    const row = view.rows[0]!;
    assert.equal(row.adapterId, null);
    assert.equal(row.mutateCommand, null);
    assert.equal(row.dispatchReady, false);
  });
});

describe("mutationDispatchView — absent queue (honest unavailable branch)", () => {
  it("undefined state ⇒ available:false + honest note + no fabricated rows", () => {
    const view = mutationDispatchView(undefined);
    assert.equal(view.available, false);
    if (view.available) return;
    assert.equal(view.executable, "disabled");
    assert.equal(view.origin, "local");
    assert.equal(view.mode, "local_only");
    assert.equal(view.total, 0);
    assert.equal(view.ready, 0);
    assert.deepEqual(view.rows, []);
    assert.match(view.note, /unavailable|local-only/i);
  });

  it("a state with no proposalQueue ⇒ available:false (mirrors mutationCenterView)", () => {
    const view = mutationDispatchView({ generatedAt: NOW } as unknown as CockpitState);
    assert.equal(view.available, false);
    if (view.available) return;
    assert.deepEqual(view.rows, []);
  });
});

describe("mutationDispatchView — present-but-non-executable queue (honest empty-state)", () => {
  it("a queue with only non-executable items ⇒ available:true, zero rows, honest note", () => {
    const view = mutationDispatchView(
      stateWith([
        item({ id: "p-draft", status: "draft" }),
        item({ id: "p-executed", status: "executed" }),
        item({ id: "p-rejected", status: "rejected" }),
      ]),
    );
    assert.equal(view.available, true);
    if (!view.available) return;
    assert.equal(view.total, 0);
    assert.equal(view.ready, 0);
    assert.deepEqual(view.rows, []);
    assert.match(view.note, /does NOT mean nothing is approved|clamps/i);
  });

  it("an empty queue ⇒ available:true with zero rows and the honest empty-state note", () => {
    const view = mutationDispatchView(stateWith([]));
    assert.equal(view.available, true);
    if (!view.available) return;
    assert.equal(view.total, 0);
    assert.equal(view.ready, 0);
    assert.deepEqual(view.rows, []);
  });
});

describe("mutationDispatchView — read-only invariants", () => {
  it("the serialized view carries NO execute/fetch/POST token and no secret (control-plane only)", () => {
    const blob = JSON.stringify(
      mutationDispatchView(stateWith([item(), clickUpItem(), item({ id: "p-sim", status: "simulated_approved" })])),
    );
    // No `--execute` token anywhere in the rendered commands or notes.
    assert.equal(/--execute/.test(blob), false);
    // No bare execution verb (allow "non-executable"/"executed"-status words via the boundaries).
    assert.equal(/(?<!non-)execute(?!d|able)/i.test(blob), false);
    assert.equal(/fetch/i.test(blob), false);
    assert.equal(/POST/i.test(blob), false);
    // No secret env values: only NAMES would ever appear, and we render none here.
    assert.equal(/CLICKUP_API_TOKEN\s*=/.test(blob), false);
    assert.equal(/HARTOS_SUPABASE_DB_URL\s*=/.test(blob), false);
  });

  it("executable is 'disabled' on the view AND every row, in every branch", () => {
    const present = mutationDispatchView(stateWith([item(), clickUpItem()]));
    assert.equal(present.executable, "disabled");
    if (present.available) for (const r of present.rows) assert.equal(r.executable, "disabled");
    const absent = mutationDispatchView(undefined);
    assert.equal(absent.executable, "disabled");
  });
});
