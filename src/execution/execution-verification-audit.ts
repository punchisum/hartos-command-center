/**
 * src/execution/execution-verification-audit.ts — P3: persist the post-execution verification verdict.
 *
 * After a gated write is independently re-read and judged (dispatchMutation's
 * DispatchResult.verification), the host executor records ONE immutable `execution_verification`
 * row on the append-only cockpit_proposal_audit table. This makes "did the change actually LAND?"
 * observable in the truth layer / Mutation Center, not just trusted because an adapter returned a
 * delta. Null verification (the adapter has no external re-verify path wired yet) ⇒ no row, ever.
 *
 * NODE-HOST ONLY (writes the audit table through an injected pg-backed Queryable). Never the Worker.
 */

import type { VerificationResult } from "./execution-verification.js";

/** The minimal pg surface this needs — the same shape the host executors already hold. */
export interface AuditQueryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

/**
 * Record the post-execution verification verdict as ONE append-only audit row. Returns true iff a
 * row was written. No-op (returns false) when `verification` is null — an adapter with no external
 * re-verify path has nothing to assert, so it records nothing rather than a false "landed".
 *
 * to_status carries the verdict (`landed` | `unverified`); detail carries the human-readable reason.
 * INSERT only — the audit trail is never rewritten.
 */
export async function recordExecutionVerification(
  db: AuditQueryable,
  proposalId: string,
  verification: VerificationResult | null,
): Promise<boolean> {
  if (!verification) return false;
  await db.query(
    `insert into public.cockpit_proposal_audit (proposal_id, event, to_status, detail) values ($1, 'execution_verification', $2, $3)`,
    [proposalId, verification.landed ? "landed" : "unverified", verification.detail],
  );
  return true;
}
