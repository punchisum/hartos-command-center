/**
 * src/execution/rollback-executor.ts — P4: the rollback execution core (PURE).
 *
 * "Undo, gated like the original." Mirrors approved-executor: a pure core over an injected gated
 * `dispatch`. It composes the inverse-command derivation (inverse-command.ts) with the fail-closed
 * rollback-gate (doctrine/rollback-gate.ts), and ONLY if both pass dispatches the inverse through
 * the SAME gated path the forward mutation used — so rollback inherits every floor (capability
 * token + per-action ALLOW_EXEC_* flag + kill-switch + live read-before-write + P3 verification).
 *
 * The host computes the gate facts (original landed from the P3 execution_verification audit;
 * live-matches-outcome from a fresh re-read) and writes the audit; this core never fetches.
 * NODE-HOST ONLY at the edges (the injected dispatch reaches pg / the ClickUp token). Never the Worker.
 */

import type { MutationCommand } from "./execution-dispatch.js";
import type { DispatchFn } from "./approved-executor.js";
import type { ExecutionOutcome } from "./execution-adapter.js";
import type { VerificationResult } from "./execution-verification.js";
import { inverseCommandFor } from "./inverse-command.js";
import { checkRollbackPrecondition } from "../doctrine/rollback-gate.js";

/** The booleans the rollback-gate needs — computed host-side (audit lookup + live re-read). */
export interface RollbackGateFacts {
  rollbackApproved: boolean;
  expiresAt: string | null;
  hasCapabilityToken: boolean;
  auditEntryWritten: boolean;
  originalExecutionConfirmed: boolean;
  liveMatchesOriginalOutcome: boolean;
  actionAllowlisted: boolean;
}

export interface RollbackExecuteInput {
  /** The original executed mutation command (reconstructed from the proposal). */
  originalCommand: MutationCommand;
  /** The recorded outcome of the original execution (before/after/ran/reversible). */
  originalOutcome: ExecutionOutcome;
  gate: RollbackGateFacts;
  env: Record<string, string | undefined>;
  dispatch: DispatchFn;
  /** Injected now (never the ambient clock). */
  now: Date;
}

export interface RollbackResult {
  outcome: "rolled_back" | "no_write" | "irreversible" | "refused" | "error";
  wrote: boolean;
  detail: string;
  verification?: VerificationResult | null;
}

/**
 * Roll back one executed mutation by dispatching its inverse through the gated path. Refuses
 * (never dispatches) when the mutation has no safe inverse or the fail-closed rollback-gate denies.
 * Never throws past an error result. Adds NO authority — the inner dispatch's gate still decides.
 */
export async function executeRollback(input: RollbackExecuteInput): Promise<RollbackResult> {
  // 1) The undo must itself be safe (reversible + an approved reverse transition).
  const inv = inverseCommandFor(input.originalCommand, input.originalOutcome);
  if (!inv.reversible) {
    return { outcome: "irreversible", wrote: false, detail: inv.reason };
  }

  // 2) The fail-closed rollback-gate: approved + not expired + token + audit + original LANDED +
  //    live still matches the original outcome + allowlisted. Any miss ⇒ refuse, no dispatch.
  const pre = checkRollbackPrecondition({
    rollbackApproved: input.gate.rollbackApproved,
    expiresAt: input.gate.expiresAt,
    now: input.now.toISOString(),
    hasCapabilityToken: input.gate.hasCapabilityToken,
    auditEntryWritten: input.gate.auditEntryWritten,
    originalExecutionConfirmed: input.gate.originalExecutionConfirmed,
    liveMatchesOriginalOutcome: input.gate.liveMatchesOriginalOutcome,
    actionAllowlisted: input.gate.actionAllowlisted,
  });
  if (!pre.allowed) {
    return { outcome: "refused", wrote: false, detail: pre.denials.join("; ") };
  }

  // 3) Dispatch the inverse through the SAME gated path (which re-reads + re-verifies the undo).
  try {
    const res = await input.dispatch(inv.command, input.env, { now: input.now });
    const wrote = res.delta !== null;
    return {
      outcome: wrote ? "rolled_back" : "no_write",
      wrote,
      detail: res.result.outcome?.summary ?? (wrote ? "rolled back" : "no write (gate refused / noop / not armed)"),
      verification: res.verification,
    };
  } catch (err) {
    return { outcome: "error", wrote: false, detail: err instanceof Error ? err.message : "unknown error" };
  }
}
