/**
 * tests/execution-dispatch.test.ts — §12/§13 unified gated execute path.
 *
 * All hermetic (injected Date, fake stores/clients, no env/network/fs):
 *  - each adapter dispatches through its gated runner (gate still fail-closed),
 *  - a real executed write projects a §13 StateDeltaSignal with the right fan-out facts,
 *  - a refusal (flag OFF), an idempotent no-op, and a dry-run all project a NULL delta,
 *  - a command may override the default delta fan-out (domain/actionType/changedEntity).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dispatchMutation } from "../src/execution/execution-dispatch.js";
import { makeClickUpCommentStore, makeClickUpMoveStore, type ClickUpRestClient } from "../src/execution/clickup-client.js";
import { CLICKUP_COMMENT_FLAG } from "../src/execution/adapters/clickup-comment.js";
import { CLICKUP_MOVE_FLAG } from "../src/execution/adapters/clickup-move-status.js";
import { REJECT_DRAFTS_FLAG, type RejectDraftsStore } from "../src/execution/adapters/reject-drafts.js";

const NOW = new Date("2026-06-09T12:00:00.000Z");
const CARD = { id: "card-123", name: "Virtual Card API Clarification" };
const PROPOSAL = { id: "p-auth", status: "approved_for_execution" as const, expiresAt: null };

function fakeClient(status: string | null, comments: Array<{ id: string; text: string }> = []): ClickUpRestClient {
  let st = status;
  const list = [...comments];
  let n = list.length;
  return {
    async getTask() { return st === null ? null : { id: CARD.id, name: CARD.name, status: st }; },
    async listComments() { return [...list]; },
    async createComment(_t, text) { const id = `c-${++n}`; list.push({ id, text }); return { id }; },
    async setStatus(_t, s) { st = s; },
  };
}

function makeRejectStore(drafts = 3): RejectDraftsStore & { rejected: number } {
  let count = drafts;
  const s = {
    rejected: 0,
    async countRejectableDrafts() { return count; },
    async rejectDraftProposals() { const n = count; count = 0; s.rejected += n; return n; },
    async stampSync() {},
  };
  return s;
}

function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.log;
  console.log = () => {};
  return fn().finally(() => { console.log = orig; });
}

describe("dispatchMutation — routes to the gated runner + projects the §13 delta", () => {
  it("clickup-comment happy path: executes once and projects an ops delta with before/after", async () => {
    const store = makeClickUpCommentStore(fakeClient("open", []));
    const out = await quiet(() => dispatchMutation(
      { adapterId: "clickup-comment", proposal: PROPOSAL, target: { cardId: CARD.id, cardName: CARD.name, commentText: "noted" }, store },
      { [CLICKUP_COMMENT_FLAG]: "true" },
      { now: NOW, hasCapabilityToken: true },
    ));
    assert.equal(out.result.executed, true);
    assert.ok(out.delta, "an executed write projects a delta");
    assert.equal(out.delta!.source, "clickup-comment");
    assert.equal(out.delta!.domain, "ops");
    assert.equal(out.delta!.actionType, "ops_followup_plan");
    assert.equal(out.delta!.changedEntity, CARD.name);
    assert.equal(out.delta!.auditId, PROPOSAL.id);
    assert.equal((out.delta!.after as Record<string, unknown>).comments, 1);
    assert.ok(out.delta!.affectedAgents.includes("Fleet Brain"));
  });

  it("clickup-move happy path: executes once and projects a delta from waiting→in progress", async () => {
    const store = makeClickUpMoveStore(fakeClient("waiting on hart"));
    const out = await quiet(() => dispatchMutation(
      { adapterId: "clickup-move-status", proposal: PROPOSAL, target: { cardId: CARD.id, cardName: CARD.name, fromStatus: "waiting on hart", toStatus: "in progress" }, store },
      { [CLICKUP_MOVE_FLAG]: "true" },
      { now: NOW, hasCapabilityToken: true },
    ));
    assert.equal(out.result.executed, true);
    assert.ok(out.delta);
    assert.deepEqual(out.delta!.before, { status: "waiting on hart" });
    assert.deepEqual(out.delta!.after, { status: "in progress" });
  });

  it("reject-drafts happy path: projects a system sync_repair delta", async () => {
    const store = makeRejectStore(3);
    const out = await quiet(() => dispatchMutation(
      { adapterId: "reject-drafts", proposal: PROPOSAL, store },
      { [REJECT_DRAFTS_FLAG]: "true" },
      { now: NOW, hasCapabilityToken: true },
    ));
    assert.equal(out.result.executed, true);
    assert.equal(store.rejected, 3);
    assert.equal(out.delta!.domain, "system");
    assert.equal(out.delta!.actionType, "sync_repair_plan");
  });

  it("flag OFF (default) → refused, NULL delta, store untouched", async () => {
    const store = makeRejectStore(3);
    const out = await quiet(() => dispatchMutation(
      { adapterId: "reject-drafts", proposal: PROPOSAL, store },
      {},
      { now: NOW, hasCapabilityToken: true },
    ));
    assert.equal(out.result.executed, false);
    assert.equal(out.delta, null, "a refusal emits no delta");
    assert.equal(store.rejected, 0);
  });

  it("idempotent no-op (already-in-target move) → NULL delta", async () => {
    const store = makeClickUpMoveStore(fakeClient("in progress"));
    const out = await quiet(() => dispatchMutation(
      { adapterId: "clickup-move-status", proposal: PROPOSAL, target: { cardId: CARD.id, cardName: CARD.name, fromStatus: "waiting on hart", toStatus: "in progress" }, store },
      { [CLICKUP_MOVE_FLAG]: "true" },
      { now: NOW },
    ));
    assert.equal(out.result.executed, false);
    assert.equal(out.delta, null);
  });

  it("dryRun → NULL delta (preview writes nothing)", async () => {
    const store = makeClickUpCommentStore(fakeClient("open", []));
    const out = await quiet(() => dispatchMutation(
      { adapterId: "clickup-comment", proposal: PROPOSAL, target: { cardId: CARD.id, cardName: CARD.name, commentText: "noted" }, store },
      { [CLICKUP_COMMENT_FLAG]: "true" },
      { now: NOW, dryRun: true },
    ));
    assert.equal(out.result.executed, false);
    assert.equal(out.delta, null);
  });

  it("a command may override the default delta fan-out facts", async () => {
    const store = makeRejectStore(2);
    const out = await quiet(() => dispatchMutation(
      { adapterId: "reject-drafts", proposal: PROPOSAL, store, delta: { domain: "ops", actionType: "review_plan", changedEntity: "custom-entity" } },
      { [REJECT_DRAFTS_FLAG]: "true" },
      { now: NOW, hasCapabilityToken: true },
    ));
    assert.equal(out.delta!.domain, "ops");
    assert.equal(out.delta!.actionType, "review_plan");
    assert.equal(out.delta!.changedEntity, "custom-entity");
  });
});
