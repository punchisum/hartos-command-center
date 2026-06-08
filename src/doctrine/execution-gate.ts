/**
 * src/doctrine/execution-gate.ts — Phase 2.5: the single fail-closed execution precondition.
 *
 * This is the ONLY gate Phase 3's execution adapter may call. It returns `allowed` only
 * when EVERY condition holds: an approved, non-expired proposal + a capability token +
 * a written audit entry + the per-action allowlist flag. Any missing condition denies,
 * with reasons.
 *
 * In Phase 2 there is no per-action allowlist yet, so `actionAllowlisted` is always false
 * → this ALWAYS denies. Execution stays disabled. Phase 3 introduces exactly one flagged,
 * allowlisted, reversible action; passing THIS gate is the only way it may run. The gate
 * is fail-closed by construction: it denies unless explicitly satisfied. Pure; no I/O.
 */

import { ACTION_EXECUTION } from "../runtime/cloudflare-security.js";
import type { ProposalQueueStatus } from "../cockpit/proposals/proposal-types.js";

/** The single lifecycle state from which execution may even be CONSIDERED. */
export const EXECUTABLE_FROM: ProposalQueueStatus = "approved_for_execution";

export interface ExecutionPreconditionInput {
  /** Current lifecycle status of the proposal being executed. */
  status: ProposalQueueStatus;
  expiresAt: string | null;
  now: string;
  /** A valid capability token was presented (never a DB key, never the Worker). */
  hasCapabilityToken: boolean;
  /** An immutable audit entry for this attempt has already been written. */
  auditEntryWritten: boolean;
  /**
   * The action is on the per-action execution allowlist (Phase 3). There is NO such
   * allowlist in Phase 2 — callers pass false, so the gate denies. This is the single
   * switch Phase 3 flips for exactly one reversible action.
   */
  actionAllowlisted: boolean;
}

export interface PreconditionResult {
  allowed: boolean;
  /** Empty iff allowed. Every failing condition is named (fail-closed, fully explained). */
  denials: string[];
}

/**
 * The fail-closed precondition. Returns `{ allowed:true, denials:[] }` ONLY when every
 * condition is satisfied; otherwise lists every reason it denied.
 */
export function checkExecutionPrecondition(p: ExecutionPreconditionInput): PreconditionResult {
  const denials: string[] = [];

  if (p.status !== EXECUTABLE_FROM) {
    denials.push(`proposal status "${p.status}" is not "${EXECUTABLE_FROM}"`);
  }
  if (p.expiresAt && Date.parse(p.expiresAt) <= Date.parse(p.now)) {
    denials.push("proposal has expired");
  }
  if (!p.hasCapabilityToken) {
    denials.push("no capability token presented (writes must use a capability token, never a DB key or the Worker)");
  }
  if (!p.auditEntryWritten) {
    denials.push("no immutable audit entry was written for this execution attempt");
  }
  if (!p.actionAllowlisted) {
    // The doctrine default. ACTION_EXECUTION is the global switch; the per-action
    // allowlist is the only thing that may carve out a single action (Phase 3).
    denials.push(`action is not on the per-action execution allowlist (ACTION_EXECUTION=${ACTION_EXECUTION})`);
  }

  return { allowed: denials.length === 0, denials };
}
