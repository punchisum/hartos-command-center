/**
 * tests/instruction-to-mutation.test.ts
 *
 * Command → dry-run mutation rehearsal. Proves the parser, the complete tier-valid T0 proposal
 * for internal cohort cleanups, the honest needs_target for ClickUp actions (no card data in the
 * read-only snapshot), unrecognized handling, and — critically — that NOTHING is executable.
 * Hermetic + deterministic.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseInstruction, planMutationFromInstruction } from "../src/cockpit/mutation/instruction-to-mutation.js";
import { assertTierPayloadComplete } from "../src/cockpit/proposals/proposal-tiering.js";
import { readMutationRoute } from "../src/cockpit/suggestions/suggestion-to-mutation.js";

const NOW = "2026-06-09T12:00:00.000Z";

describe("parseInstruction", () => {
  it("recognizes the internal cohort cleanups", () => {
    assert.equal(parseInstruction("reject the draft proposals").action, "reject-drafts");
    assert.equal(parseInstruction("archive the rejected proposals").action, "archive-rejected");
  });
  it("recognizes ClickUp card actions + extracts payload", () => {
    const c = parseInstruction("comment 'paid in full' on card abc123");
    assert.equal(c.action, "clickup-comment");
    assert.equal(c.payload.commentText, "paid in full");
    const m = parseInstruction("move card abc123 to in review");
    assert.equal(m.action, "clickup-move");
    assert.equal(m.payload.toStatus, "in review");
  });
  it("returns null action for an unrecognized instruction", () => {
    assert.equal(parseInstruction("what's the weather").action, null);
    assert.equal(parseInstruction("").action, null);
  });
});

describe("planMutationFromInstruction — internal cohort (ready, tier-valid, dry-run)", () => {
  it("reject-drafts → a complete T0 proposal that passes the executor's tier gate", () => {
    const r = planMutationFromInstruction("reject the draft proposals", { now: NOW });
    assert.equal(r.status, "ready");
    const p = r.proposal!;
    assert.equal(p.tier, "T0");
    assert.equal(p.executable, false, "rehearsal is NEVER executable");
    assert.equal(p.requiredApproval, "Hart");
    assert.equal(p.status, "draft");
    // The SAME gate the real executor consults must pass.
    assert.equal(assertTierPayloadComplete(p).allowed, true);
    // The adapter route is baked in so the dispatcher could read it back.
    assert.deepEqual(readMutationRoute(p), { adapterId: "reject-drafts", tier: "T0" });
    assert.ok(p.idempotencyKey && p.idempotencyKey.length > 0);
    assert.match(p.rollbackOrCorrectionNote!, /reversible/i);
    assert.equal(p.dryRunResult!.executed, false);
  });

  it("archive-rejected → complete T0 proposal, distinct target + rollback", () => {
    const r = planMutationFromInstruction("archive the rejected proposals", { now: NOW });
    assert.equal(r.status, "ready");
    assert.equal(r.proposal!.targetId, "cohort:proposals:status=rejected");
    assert.equal(assertTierPayloadComplete(r.proposal!).allowed, true);
  });

  it("idempotency key uses trusted parts only (date-scoped, no instruction text)", () => {
    const r = planMutationFromInstruction("reject the draft proposals", { now: NOW });
    // key contains the date, never the free-text instruction
    assert.match(r.proposal!.idempotencyKey!, /2026-06-09/);
    assert.ok(!r.proposal!.idempotencyKey!.includes("reject the draft"));
  });
});

describe("planMutationFromInstruction — ClickUp (honest needs_target)", () => {
  it("comment on card → needs_target (no card data in the read-only snapshot)", () => {
    const r = planMutationFromInstruction("comment 'paid' on card abc123", { now: NOW });
    assert.equal(r.status, "needs_target");
    assert.equal(r.proposal, null, "no proposal until a real target is supplied — never guessed");
    assert.ok(r.required.includes("cardId"));
    assert.match(r.note, /will NOT guess/i);
  });
  it("move card → needs_target and lists the missing status", () => {
    const r = planMutationFromInstruction("move card abc123", { now: NOW });
    assert.equal(r.status, "needs_target");
    assert.ok(r.required.some((x) => /toStatus/.test(x)));
  });
});

describe("planMutationFromInstruction — unrecognized", () => {
  it("returns unrecognized with guidance, no proposal", () => {
    const r = planMutationFromInstruction("tell me a joke", { now: NOW });
    assert.equal(r.status, "unrecognized");
    assert.equal(r.proposal, null);
    assert.match(r.note, /no recognized mutation/i);
  });
});
