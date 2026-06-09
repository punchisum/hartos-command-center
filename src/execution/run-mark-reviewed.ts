/**
 * src/execution/run-mark-reviewed.ts — plan §14: the gated mark-reviewed executor (T2 ops-mirror).
 *
 * Mirrors `runArchiveRejected`: the Node host enforces the Phase 2.5 fail-closed gate (via
 * `runExecutionAdapter`) and, only when it passes, drives the action through the injected
 * executor store (the pg store from run-mark-reviewed-db.ts holds the elevated Node DB
 * credential; the gate runs BEFORE any write). `dryRun:true` only counts (never writes); the
 * per-action allowlist flag (`MARK_REVIEWED_FLAG`) is OFF by default, so nothing runs until
 * it is deliberately, narrowly enabled.
 *
 * This action is BULK-BY-DOMAIN — it has no single target proposal row whose live status must
 * equal `EXECUTABLE_FROM`, so there is no per-row live-status verification branch on the
 * TRIGGER. The T2 read-before-write happens inside the adapter's `execute` (a beforeState
 * snapshot of the ops rows it touches). The TRIGGERING proposal (the authorization carrier) is
 * what the gate checks: its `approved_for_execution` status + non-expiry + capability token.
 */

import { runExecutionAdapter, type ExecutionContext, type AdapterRunResult } from "./execution-adapter.js";
import { markReviewedAdapter, type MarkReviewedStore } from "./adapters/mark-reviewed.js";

export interface MarkReviewedProposal {
  id: string;
  status: ExecutionContext["status"];
  expiresAt: string | null;
}

/**
 * Run the gated mark-reviewed action against an authorized proposal. `runExecutionAdapter`
 * enforces the gate + the per-action allowlist flag BEFORE any write — pass `dryRun:true` to only
 * count (never write). Returns the adapter run result (incl. before/after, with the T2 beforeState
 * snapshot surfaced in `before`). The store MUST be injected (the LIVE pg store from
 * `makeMarkReviewedStore`); there is no trigger live-status read branch because the action is
 * bulk-by-domain, not single-target.
 */
export async function runMarkReviewed(
  proposal: MarkReviewedProposal,
  env: Record<string, string | undefined>,
  opts: { now?: string; dryRun?: boolean; store: MarkReviewedStore; hasCapabilityToken?: boolean },
): Promise<AdapterRunResult> {
  const now = opts.now ?? new Date().toISOString();
  const store = opts.store;
  const ctx: ExecutionContext = {
    proposalId: proposal.id,
    status: proposal.status,
    expiresAt: proposal.expiresAt,
    now,
    // Write authorization = a capability token OR the elevated Node DB credential (the pg executor
    // store). An explicit override wins when the caller knows.
    hasCapabilityToken: opts.hasCapabilityToken ?? Boolean(env.HARTOS_ASK_WRITE_TOKEN || env.HARTOS_SUPABASE_DB_URL),
    env,
  };
  const writeAudit = async (event: string, detail: string): Promise<void> => {
    // Framework-level trace; the DURABLE audit row is written by the store's stampSync.
    console.log(`[exec-audit] ${event}: ${detail}`);
  };

  if (opts.dryRun) {
    const outcome = await markReviewedAdapter.dryRun({ store, now, proposalId: proposal.id });
    await writeAudit("execution_dry_run", outcome.summary);
    return { adapterId: markReviewedAdapter.id, precondition: { allowed: true, denials: [] }, executed: false, outcome };
  }

  return runExecutionAdapter(markReviewedAdapter, ctx, {
    adapterDeps: { store, now, proposalId: proposal.id },
    writeAudit,
  });
}
