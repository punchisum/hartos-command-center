/**
 * src/doctrine/rollback-gate.ts — Phase 4: the fail-closed precondition for ROLLING BACK an
 * executed mutation. Mirrors execution-gate.ts: returns `allowed` only when EVERY condition holds,
 * otherwise lists every reason. PURE — the caller does the live re-read + audit lookup and passes
 * booleans; the gate never fetches and never loosens the floor.
 *
 * Two safety rules unique to rollback:
 *   - You may only roll back a mutation whose ORIGINAL execution is confirmed to have landed
 *     (rolling back something that never happened would itself be an unintended mutation).
 *   - The live target must STILL match the original post-write state. If it diverged (a later
 *     change landed on top), rolling back would clobber that change — so the gate refuses.
 */

import type { PreconditionResult } from "./execution-gate.js";

export interface RollbackPreconditionInput {
  /** The rollback proposal is approved for execution (caller maps the lifecycle status). */
  rollbackApproved: boolean;
  expiresAt: string | null;
  now: string;
  hasCapabilityToken: boolean;
  auditEntryWritten: boolean;
  /** The audit trail confirms the ORIGINAL mutation actually executed and landed. */
  originalExecutionConfirmed: boolean;
  /** A live re-read confirms the target still matches the original post-write state (outcome.after). */
  liveMatchesOriginalOutcome: boolean;
  /** The rollback action is on the per-action allowlist. */
  actionAllowlisted: boolean;
}

export function checkRollbackPrecondition(p: RollbackPreconditionInput): PreconditionResult {
  const denials: string[] = [];

  if (!p.rollbackApproved) {
    denials.push("rollback is not approved for execution");
  }
  if (p.expiresAt && Date.parse(p.expiresAt) <= Date.parse(p.now)) {
    denials.push("rollback proposal has expired");
  }
  if (!p.hasCapabilityToken) {
    denials.push("no capability token presented (rollback writes must use a capability token)");
  }
  if (!p.auditEntryWritten) {
    denials.push("no immutable audit entry was written for this rollback attempt");
  }
  if (!p.originalExecutionConfirmed) {
    denials.push("original execution not confirmed to have landed — refusing to roll back a mutation that never happened");
  }
  if (!p.liveMatchesOriginalOutcome) {
    denials.push("live target diverged from the original post-write state — refusing to clobber a later change");
  }
  if (!p.actionAllowlisted) {
    denials.push("rollback action is not on the per-action allowlist");
  }

  return { allowed: denials.length === 0, denials };
}
