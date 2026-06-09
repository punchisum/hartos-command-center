/**
 * src/execution/run-archive-rejected.ts — plan §14: the gated archive-rejected executor.
 *
 * Mirrors `runRefreshSync`: the Node host enforces the Phase 2.5 fail-closed gate (via
 * `runExecutionAdapter`) and, only when it passes, drives the action through the injected
 * executor store (the pg store from run-archive-rejected-db.ts holds the elevated Node DB
 * credential; the gate runs BEFORE any write). `dryRun:true` only counts (never writes); the
 * per-action allowlist flag (`ARCHIVE_REJECTED_FLAG`) is OFF by default, so nothing runs until
 * it is deliberately, narrowly enabled.
 *
 * Unlike refresh-sync, this action is BULK-BY-STATUS — it has no single target proposal row
 * whose live status must equal `EXECUTABLE_FROM`, so there is no per-row read-before-write
 * verification branch. The TRIGGERING proposal (the authorization carrier) is what the gate
 * checks: its `approved_for_execution` status + non-expiry + capability token gate the action.
 */

import { runExecutionAdapter, type ExecutionContext, type AdapterRunResult } from "./execution-adapter.js";
import { archiveRejectedAdapter, type ArchiveRejectedStore } from "./adapters/archive-rejected.js";

export interface ArchiveRejectedProposal {
  id: string;
  status: ExecutionContext["status"];
  expiresAt: string | null;
}

/**
 * Run the gated archive-rejected action against an authorized proposal. `runExecutionAdapter`
 * enforces the gate + the per-action allowlist flag BEFORE any write — pass `dryRun:true` to only
 * count (never write). Returns the adapter run result (incl. before/after). The store MUST be
 * injected (the LIVE pg store from `makeArchiveRejectedStore`); there is no live-status read branch
 * because the action is bulk-by-status, not single-target.
 */
export async function runArchiveRejected(
  proposal: ArchiveRejectedProposal,
  env: Record<string, string | undefined>,
  opts: { now?: string; dryRun?: boolean; store: ArchiveRejectedStore; hasCapabilityToken?: boolean },
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
    const outcome = await archiveRejectedAdapter.dryRun({ store, now, proposalId: proposal.id });
    await writeAudit("execution_dry_run", outcome.summary);
    return { adapterId: archiveRejectedAdapter.id, precondition: { allowed: true, denials: [] }, executed: false, outcome };
  }

  return runExecutionAdapter(archiveRejectedAdapter, ctx, {
    adapterDeps: { store, now, proposalId: proposal.id },
    writeAudit,
  });
}
