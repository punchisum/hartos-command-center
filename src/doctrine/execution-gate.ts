/**
 * src/doctrine/execution-gate.ts — Phase 2.5: the single fail-closed execution precondition.
 *
 * This is the ONLY gate Phase 3's execution adapter may call. It returns `allowed` only
 * when EVERY condition holds: an approved, non-expired proposal + a capability token +
 * a written audit entry + the per-action allowlist flag. Any missing condition denies,
 * with reasons.
 *
 * Level-0 hardening (plan §1/§10/§11): the caller may also assert that the LIVE DB row was
 * re-read and confirmed `approved_for_execution` BEFORE writing (`liveStatusVerified`). When
 * that assertion is explicitly `false`, the gate adds a denial. This is purely ADDITIVE — it
 * can only refuse, never loosen the fail-closed floor — and keeps the gate PURE (the caller
 * does the read; the gate never fetches).
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
  /**
   * The LIVE target row was re-read from the DB and its status matched `EXECUTABLE_FROM`
   * (read-before-write, plan §1/§10). The gate is PURE — it does NOT fetch; the caller
   * performs the live read, compares it against `EXECUTABLE_FROM` (and the asserted status),
   * and passes the boolean. `false` ⇒ the row could not be confirmed or did not match, so the
   * gate DENIES (additive — it can only refuse, never loosen the floor). Optional so the
   * existing `runExecutionAdapter` path (which verifies upstream, in `runRefreshSync`) need not
   * change; when omitted no new denial is added, when present `false` always denies. The
   * live-verifying caller (`runRefreshSync`) refuses BEFORE the adapter on a mismatch/missing
   * row, so a write can never proceed on an unconfirmed status.
   */
  liveStatusVerified?: boolean;
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
  if (p.liveStatusVerified === false) {
    denials.push("live target status not verified or mismatched (the DB row was not re-read and confirmed approved_for_execution before write)");
  }
  if (!p.actionAllowlisted) {
    // The doctrine default. ACTION_EXECUTION is the global switch; the per-action
    // allowlist is the only thing that may carve out a single action (Phase 3).
    denials.push(`action is not on the per-action execution allowlist (ACTION_EXECUTION=${ACTION_EXECUTION})`);
  }

  return { allowed: denials.length === 0, denials };
}
