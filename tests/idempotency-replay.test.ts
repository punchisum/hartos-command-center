/**
 * tests/idempotency-replay.test.ts — P3: pre-dispatch idempotency-replay enforcement.
 *
 * The external adapters are already STRUCTURALLY idempotent (clickup-move no-ops if the card is
 * already in the target; clickup-comment skips if its marker exists). This module adds the
 * PRE-dispatch skip the audit flagged as missing: derive a command's canonical idempotency key
 * (from TRUSTED fields only, via the canonical lib/idempotency-key module) and skip re-dispatch
 * when that key was already executed — in this same batch, or in a prior run (`alreadyLanded`).
 *
 * Internal bulk adapters (refresh-sync / reject-drafts / archive-rejected / mark-reviewed) carry
 * no per-row key — they are idempotent by their own read-before-write — so they are never replays.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { idempotencyKeyForCommand, isReplay } from "../src/execution/idempotency-replay.js";
import type { MutationCommand } from "../src/execution/execution-dispatch.js";

const PROPOSAL = { id: "p-1", status: "approved_for_execution" as const, expiresAt: null };
const STORE = {} as never;

function move(cardId: string, fromStatus: string, toStatus: string): MutationCommand {
  return { adapterId: "clickup-move-status", proposal: PROPOSAL, target: { cardId, cardName: "C", fromStatus, toStatus }, store: STORE };
}

describe("idempotencyKeyForCommand — canonical key from trusted fields", () => {
  it("derives a deterministic key for a clickup-move from card + the two statuses", () => {
    const k1 = idempotencyKeyForCommand(move("86a", "in progress", "on hold"));
    const k2 = idempotencyKeyForCommand(move("86a", "in progress", "on hold"));
    assert.ok(k1);
    assert.equal(k1, k2, "same move ⇒ same key");
  });

  it("gives different moves different keys", () => {
    assert.notEqual(
      idempotencyKeyForCommand(move("86a", "in progress", "on hold")),
      idempotencyKeyForCommand(move("86a", "in progress", "in review")),
    );
    assert.notEqual(
      idempotencyKeyForCommand(move("86a", "in progress", "on hold")),
      idempotencyKeyForCommand(move("86b", "in progress", "on hold")),
    );
  });

  it("derives a key for a clickup-comment from card + proposal id", () => {
    const k = idempotencyKeyForCommand({
      adapterId: "clickup-comment", proposal: PROPOSAL, target: { cardId: "86a", cardName: "C", commentText: "noted" }, store: STORE,
    });
    assert.ok(k);
  });

  it("returns null for internal bulk adapters (no per-row key; structurally idempotent)", () => {
    assert.equal(idempotencyKeyForCommand({ adapterId: "reject-drafts", proposal: PROPOSAL, store: STORE }), null);
    assert.equal(idempotencyKeyForCommand({ adapterId: "refresh-sync", proposal: PROPOSAL, store: STORE }), null);
  });

  it("returns null (never throws) when a trusted key cannot be derived — e.g. an LLM-slug proposal id", () => {
    // clickup-comment keys off the proposal id; some ids are LLM-derived slugs the canonical module
    // rejects as natural language. We must not crash the executor — no safe key ⇒ no replay claim.
    const cmd = {
      adapterId: "clickup-comment",
      proposal: { id: "triage the blocked card and notify hart", status: "approved_for_execution", expiresAt: null },
      target: { cardId: "86a", cardName: "C", commentText: "x" }, store: STORE,
    } as unknown as MutationCommand;
    assert.equal(idempotencyKeyForCommand(cmd), null);
  });
});

describe("isReplay — same-batch + prior-run detection", () => {
  it("is NOT a replay the first time a key is seen", () => {
    assert.equal(isReplay("k1", new Set(), new Set()), false);
  });

  it("IS a replay when the key was already seen in this batch", () => {
    assert.equal(isReplay("k1", new Set(["k1"]), new Set()), true);
  });

  it("IS a replay when the key already landed in a prior run", () => {
    assert.equal(isReplay("k1", new Set(), new Set(["k1"])), true);
  });

  it("a null key (internal adapter) is never a replay", () => {
    assert.equal(isReplay(null, new Set(["k1"]), new Set(["k1"])), false);
  });
});
