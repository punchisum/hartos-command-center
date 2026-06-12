import { test } from "node:test";
import assert from "node:assert/strict";

import { checkRollbackPrecondition } from "../src/doctrine/rollback-gate.js";

const OK = {
  rollbackApproved: true,
  expiresAt: null,
  now: "2026-06-12T10:00:00.000Z",
  hasCapabilityToken: true,
  auditEntryWritten: true,
  originalExecutionConfirmed: true,
  liveMatchesOriginalOutcome: true,
  actionAllowlisted: true,
};

test("checkRollbackPrecondition allows only when every condition holds", () => {
  assert.equal(checkRollbackPrecondition(OK).allowed, true);
});

test("checkRollbackPrecondition refuses to roll back a mutation that never confirmed landing", () => {
  const r = checkRollbackPrecondition({ ...OK, originalExecutionConfirmed: false });
  assert.equal(r.allowed, false);
  assert.ok(r.denials.some((d) => /never|not confirmed|original/i.test(d)), `denials: ${r.denials.join("; ")}`);
});

test("checkRollbackPrecondition refuses when the live target diverged from the original outcome", () => {
  const r = checkRollbackPrecondition({ ...OK, liveMatchesOriginalOutcome: false });
  assert.equal(r.allowed, false);
  assert.ok(r.denials.some((d) => /diverg|clobber|later/i.test(d)), `denials: ${r.denials.join("; ")}`);
});

test("checkRollbackPrecondition is fail-closed: a blank request is denied with several reasons", () => {
  const r = checkRollbackPrecondition({
    rollbackApproved: false,
    expiresAt: null,
    now: "2026-06-12T10:00:00.000Z",
    hasCapabilityToken: false,
    auditEntryWritten: false,
    originalExecutionConfirmed: false,
    liveMatchesOriginalOutcome: false,
    actionAllowlisted: false,
  });
  assert.equal(r.allowed, false);
  assert.ok(r.denials.length >= 5, `expected many denials, got ${r.denials.length}`);
});
