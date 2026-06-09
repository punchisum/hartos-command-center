/**
 * tests/execution-gate.test.ts — Phase 2.5.
 * The fail-closed execution precondition: denies unless EVERY condition holds, and in
 * Phase 2 (no per-action allowlist) it ALWAYS denies — execution stays disabled.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkExecutionPrecondition, EXECUTABLE_FROM } from "../src/doctrine/execution-gate.js";

const now = "2026-06-08T12:00:00Z";
const future = "2026-06-09T12:00:00Z";
const past = "2026-06-07T12:00:00Z";

// Fully satisfied — tests vary one field at a time. actionAllowlisted=true is the
// hypothetical Phase-3 state; Phase 2 callers always pass false.
const satisfied = {
  status: EXECUTABLE_FROM,
  expiresAt: future,
  now,
  hasCapabilityToken: true,
  auditEntryWritten: true,
  actionAllowlisted: true,
  liveStatusVerified: true,
} as const;

describe("execution precondition gate (2.5)", () => {
  it("fail-closed: a false/empty input denies and names every failing condition", () => {
    const r = checkExecutionPrecondition({
      status: "draft", expiresAt: past, now, hasCapabilityToken: false, auditEntryWritten: false, actionAllowlisted: false, liveStatusVerified: false,
    });
    assert.equal(r.allowed, false);
    assert.ok(r.denials.length >= 6, `every failing condition named, got: ${r.denials.length}`);
  });

  it("Phase 2 reality: proposal+token+audit but NO allowlist → still denied", () => {
    const r = checkExecutionPrecondition({ ...satisfied, actionAllowlisted: false });
    assert.equal(r.allowed, false);
    assert.ok(r.denials.some((d) => d.includes("allowlist")));
  });

  it("allows ONLY when every condition holds (the gate Phase 3 must pass)", () => {
    assert.deepEqual(checkExecutionPrecondition(satisfied), { allowed: true, denials: [] });
  });

  it("denies a non-approved status", () => {
    assert.equal(checkExecutionPrecondition({ ...satisfied, status: "pending_approval" }).allowed, false);
  });
  it("denies an expired proposal", () => {
    assert.equal(checkExecutionPrecondition({ ...satisfied, expiresAt: past }).allowed, false);
  });
  it("denies a missing capability token", () => {
    assert.equal(checkExecutionPrecondition({ ...satisfied, hasCapabilityToken: false }).allowed, false);
  });
  it("denies a missing audit entry", () => {
    assert.equal(checkExecutionPrecondition({ ...satisfied, auditEntryWritten: false }).allowed, false);
  });

  it("denies when live status is NOT verified (read-before-write), naming the reason", () => {
    const r = checkExecutionPrecondition({ ...satisfied, liveStatusVerified: false });
    assert.equal(r.allowed, false);
    assert.ok(r.denials.some((d) => d.includes("live target status not verified")));
  });

  it("allows when liveStatusVerified is true and every other condition holds", () => {
    assert.deepEqual(checkExecutionPrecondition({ ...satisfied, liveStatusVerified: true }), { allowed: true, denials: [] });
  });

  it("omitting liveStatusVerified adds NO new denial (legacy caller; additive-only)", () => {
    const { liveStatusVerified: _omit, ...withoutLive } = satisfied;
    const r = checkExecutionPrecondition(withoutLive);
    assert.equal(r.allowed, true);
    assert.ok(!r.denials.some((d) => d.includes("live target status")));
  });
});
