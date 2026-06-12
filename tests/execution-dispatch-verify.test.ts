/**
 * tests/execution-dispatch-verify.test.ts — P3: dispatchMutation post-execution verification.
 *
 * After a mutation actually writes (non-null delta), dispatchMutation must do an INDEPENDENT,
 * FRESH per-adapter re-read and judge whether the change LANDED — not merely trust that the
 * adapter returned a delta. Fails CLOSED: a failed/absent re-read ⇒ not landed. Adapters with
 * no external re-verify path yet ⇒ verification is null (added as each path is wired).
 *
 * Hermetic: injected Date, fake clients, no env/network/fs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dispatchMutation } from "../src/execution/execution-dispatch.js";
import { makeClickUpMoveStore, type ClickUpRestClient } from "../src/execution/clickup-client.js";
import { CLICKUP_MOVE_FLAG } from "../src/execution/adapters/clickup-move-status.js";
import { REJECT_DRAFTS_FLAG, type RejectDraftsStore } from "../src/execution/adapters/reject-drafts.js";

const NOW = new Date("2026-06-09T12:00:00.000Z");
const CARD = { id: "card-123", name: "Virtual Card API Clarification" };
const PROPOSAL = { id: "p-verify", status: "approved_for_execution" as const, expiresAt: null };

/** A fake ClickUp client whose setStatus moves the card to whatever it actually lands at. */
function landingClient(start: string, landsAt: string): ClickUpRestClient {
  let st = start;
  return {
    async getTask() { return { id: CARD.id, name: CARD.name, status: st }; },
    async listComments() { return []; },
    async createComment(_t, _text) { return { id: "c-1" }; },
    async setStatus(_t, _s) { st = landsAt; }, // the move "lands" wherever landsAt says
  };
}

/** A fake client that returns the card on its FIRST read (read-before-write), then null forever. */
function vanishAfterFirstReadClient(start: string): ClickUpRestClient {
  let calls = 0;
  return {
    async getTask() { calls += 1; return calls === 1 ? { id: CARD.id, name: CARD.name, status: start } : null; },
    async listComments() { return []; },
    async createComment(_t, _text) { return { id: "c-1" }; },
    async setStatus(_t, _s) {},
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

describe("dispatchMutation — post-execution verification (P3)", () => {
  it("clickup-move that truly landed → verification.landed === true (fresh re-read shows the target)", async () => {
    const store = makeClickUpMoveStore(landingClient("waiting on hart", "in progress"));
    const out = await quiet(() => dispatchMutation(
      { adapterId: "clickup-move-status", proposal: PROPOSAL, target: { cardId: CARD.id, cardName: CARD.name, fromStatus: "waiting on hart", toStatus: "in progress" }, store },
      { [CLICKUP_MOVE_FLAG]: "true" },
      { now: NOW, hasCapabilityToken: true },
    ));
    assert.equal(out.result.executed, true);
    assert.ok(out.delta, "a real write projects a delta");
    assert.ok(out.verification, "an executed clickup-move must be verified");
    assert.equal(out.verification!.landed, true);
  });

  it("clickup-move whose card diverged → verification.landed === false (re-read != target)", async () => {
    // The write executes (delta non-null) but the card ends up at a DIFFERENT status than intended
    // (e.g. a concurrent move). The independent re-read must catch that the change did not land.
    const store = makeClickUpMoveStore(landingClient("waiting on hart", "in review"));
    const out = await quiet(() => dispatchMutation(
      { adapterId: "clickup-move-status", proposal: PROPOSAL, target: { cardId: CARD.id, cardName: CARD.name, fromStatus: "waiting on hart", toStatus: "in progress" }, store },
      { [CLICKUP_MOVE_FLAG]: "true" },
      { now: NOW, hasCapabilityToken: true },
    ));
    assert.equal(out.result.executed, true);
    assert.ok(out.delta);
    assert.ok(out.verification, "an executed clickup-move must be verified");
    assert.equal(out.verification!.landed, false);
  });

  it("clickup-move whose fresh re-read fails (card vanished) → fails CLOSED (landed === false)", async () => {
    // Read-before-write sees the card; the post-write fresh re-read returns null. An unverifiable
    // write is unproven, never silently 'done'.
    const store = makeClickUpMoveStore(vanishAfterFirstReadClient("waiting on hart"));
    const out = await quiet(() => dispatchMutation(
      { adapterId: "clickup-move-status", proposal: PROPOSAL, target: { cardId: CARD.id, cardName: CARD.name, fromStatus: "waiting on hart", toStatus: "in progress" }, store },
      { [CLICKUP_MOVE_FLAG]: "true" },
      { now: NOW, hasCapabilityToken: true },
    ));
    assert.equal(out.result.executed, true);
    assert.ok(out.delta);
    assert.ok(out.verification, "even an unverifiable write yields a (fail-closed) verification");
    assert.equal(out.verification!.landed, false);
  });

  it("an adapter with no external re-verify path yet (reject-drafts) → verification is null even on a real write", async () => {
    const store = makeRejectStore(3);
    const out = await quiet(() => dispatchMutation(
      { adapterId: "reject-drafts", proposal: PROPOSAL, store },
      { [REJECT_DRAFTS_FLAG]: "true" },
      { now: NOW, hasCapabilityToken: true },
    ));
    assert.equal(out.result.executed, true);
    assert.ok(out.delta, "reject-drafts still projects a delta");
    assert.equal(out.verification, null, "no re-verify path wired ⇒ null (honest, not a false landed)");
  });

  it("no write (flag OFF refusal) → verification is null (nothing to verify)", async () => {
    const store = makeClickUpMoveStore(landingClient("waiting on hart", "in progress"));
    const out = await quiet(() => dispatchMutation(
      { adapterId: "clickup-move-status", proposal: PROPOSAL, target: { cardId: CARD.id, cardName: CARD.name, fromStatus: "waiting on hart", toStatus: "in progress" }, store },
      {},
      { now: NOW, hasCapabilityToken: true },
    ));
    assert.equal(out.result.executed, false);
    assert.equal(out.delta, null);
    assert.equal(out.verification, null);
  });
});
