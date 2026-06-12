/**
 * src/execution/rollback-request.ts — P4: assemble a RollbackExecuteInput from an executed move.
 *
 * The bridge between a real executed-move proposal (its payload move facts + a fresh live re-read +
 * the P3 landed-confirmation) and the pure rollback-executor. Reconstructs the original command and
 * its (landed) outcome, and packages the host-computed rollback-gate facts. PURE — the host does the
 * re-read + the audit lookup and passes the results here; this never fetches.
 *
 * Reconstructing before/after from from/to is valid ONLY because the original was confirmed landed:
 * the card therefore sits at `toStatus` now, which is exactly outcome.after.
 */

import type { MutationCommand } from "./execution-dispatch.js";
import type { ExecutionOutcome, ExecutionContext } from "./execution-adapter.js";
import type { ClickUpMoveStore } from "./adapters/clickup-move-status.js";
import type { RollbackGateFacts } from "./rollback-executor.js";

export interface ExecutedMoveRollbackArgs {
  cardId: string;
  cardName: string;
  fromStatus: string;
  toStatus: string;
  /** A reference to the ORIGINAL executed proposal (id/status/expiry). */
  proposalRef: { id: string; status: ExecutionContext["status"]; expiresAt: string | null };
  /** The injected live ClickUp move store (token-bearing on the host; a fake in tests). */
  store: ClickUpMoveStore;
  /** A fresh re-read of the card's live status, or null if the re-read failed. */
  liveStatus: string | null;
  /** The P3 audit confirms the original move was verified landed. */
  originalLandedConfirmed: boolean;
  /** The rollback proposal is approved for execution. */
  rollbackApproved: boolean;
  hasCapabilityToken: boolean;
  /** The clickup-move action is on the per-action allowlist (ALLOW_EXEC_CLICKUP_MOVE armed). */
  actionAllowlisted: boolean;
  /** The rollback proposal's expiry (if any). */
  rollbackExpiresAt: string | null;
}

export interface ReconstructedRollback {
  originalCommand: MutationCommand;
  originalOutcome: ExecutionOutcome;
  gate: RollbackGateFacts;
}

/**
 * Build the original command + landed outcome + rollback-gate facts for an executed clickup-move.
 * `liveMatchesOriginalOutcome` is true iff a fresh re-read still shows the card at `toStatus`
 * (where the landed move left it); a divergence or a failed re-read fails closed (false).
 */
export function rollbackInputForExecutedMove(args: ExecutedMoveRollbackArgs): ReconstructedRollback {
  const originalCommand: MutationCommand = {
    adapterId: "clickup-move-status",
    proposal: args.proposalRef,
    target: { cardId: args.cardId, cardName: args.cardName, fromStatus: args.fromStatus, toStatus: args.toStatus },
    store: args.store,
  };

  const originalOutcome: ExecutionOutcome = {
    ran: true,
    reversible: true,
    before: { status: args.fromStatus },
    after: { status: args.toStatus },
    summary: `Original move ${args.fromStatus} → ${args.toStatus} on card ${args.cardId} (confirmed landed).`,
  };

  const gate: RollbackGateFacts = {
    rollbackApproved: args.rollbackApproved,
    expiresAt: args.rollbackExpiresAt,
    hasCapabilityToken: args.hasCapabilityToken,
    auditEntryWritten: true, // the host writes the rollback attempt audit before calling
    originalExecutionConfirmed: args.originalLandedConfirmed,
    // Fail closed: a divergence OR a failed re-read (null) ⇒ not a match.
    liveMatchesOriginalOutcome: args.liveStatus !== null && args.liveStatus === args.toStatus,
    actionAllowlisted: args.actionAllowlisted,
  };

  return { originalCommand, originalOutcome, gate };
}
