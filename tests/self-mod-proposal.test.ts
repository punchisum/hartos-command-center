/**
 * tests/self-mod-proposal.test.ts — unit tests for the Tier-2 self-mod proposal adapter.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSelfModProposal } from "../src/execution/self-mod-proposal.js";
import type { SelfModProposalStore } from "../src/execution/self-mod-proposal.js";
import type { ProposalQueueItem } from "../src/cockpit/proposals/proposal-types.js";

/** In-memory fake store that records upserted items. */
function makeFakeStore(): SelfModProposalStore & { items: ProposalQueueItem[] } {
  const items: ProposalQueueItem[] = [];
  return {
    items,
    async upsert(item: ProposalQueueItem): Promise<void> {
      items.push(item);
    },
  };
}

const baseTask = { selfModClass: "extend" as const, description: "Add rate-limiter to the live-runner polling loop" };
const baseVerdict = { tier: "propose-only" as const, reason: 'class "extend" is propose-only (only fix/recalibrate may auto-apply)' };
const baseDiff = "--- a/src/execution/live-runner.ts\n+++ b/src/execution/live-runner.ts\n@@ -1,3 +1,5 @@\n+const RATE_LIMIT = 10;\n";
const baseNow = new Date("2026-06-14T09:00:00.000Z");

test("upserts exactly one item with the correct domain, actionType, status, and executable", async () => {
  const store = makeFakeStore();
  await createSelfModProposal(store, baseTask, baseVerdict, baseDiff, baseNow);

  assert.equal(store.items.length, 1, "should upsert exactly one item");
  const item = store.items[0]!;
  assert.equal(item.domain, "self-mod");
  assert.equal(item.actionType, "self_mod_plan");
  assert.equal(item.status, "pending_approval");
  assert.equal(item.executable, false);
});

test("payload carries class, tier, reason, and (truncated) diff", async () => {
  const store = makeFakeStore();
  await createSelfModProposal(store, baseTask, baseVerdict, baseDiff, baseNow);

  const payload = store.items[0]!.proposedPayload as Record<string, unknown>;
  assert.equal(payload["class"], "extend");
  assert.equal(payload["tier"], "propose-only");
  assert.equal(payload["reason"], baseVerdict.reason);
  assert.equal(payload["diff"], baseDiff);
});

test("id is deterministic: two calls with the same now produce the same id", async () => {
  const store1 = makeFakeStore();
  const store2 = makeFakeStore();
  const now = new Date("2026-06-14T10:30:00.000Z");

  const id1 = await createSelfModProposal(store1, baseTask, baseVerdict, baseDiff, now);
  const id2 = await createSelfModProposal(store2, baseTask, baseVerdict, baseDiff, now);

  assert.equal(id1, id2, "ids must be identical for the same now");
  assert.match(id1, /^prop-self-mod-/, "id should start with 'prop-self-mod-'");
});

test("a very long diff is truncated to at most 8000 chars in the payload", async () => {
  const store = makeFakeStore();
  const longDiff = "x".repeat(20_000);

  await createSelfModProposal(store, baseTask, baseVerdict, longDiff, baseNow);

  const payload = store.items[0]!.proposedPayload as Record<string, unknown>;
  const storedDiff = payload["diff"] as string;
  assert.ok(storedDiff.length <= 8000, `diff in payload should be ≤ 8000 chars, got ${storedDiff.length}`);
  assert.equal(storedDiff, longDiff.slice(0, 8000));
});
