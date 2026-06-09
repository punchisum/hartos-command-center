/**
 * src/execution/run-reject-drafts.ts — plan §14: the gated reject-drafts executor.
 *
 * The Node host enforces the Phase 2.5 fail-closed gate (via `runExecutionAdapter`) and, only
 * when it passes, drives the action through the injected store. `dryRun:true` is the read-only
 * count (no write); the real path counts → rejects every `draft` row → stamps the durable audit.
 *
 * Unlike refresh-sync there is NO single-row live-status verification branch: this action is
 * bulk-by-status (`status='draft'`), so there is no per-row target to re-read before writing.
 * The fail-closed gate (approved_for_execution authorizing proposal + non-expired + capability
 * token + audit + the per-action allowlist flag) is still the only way it may run. Flag OFF by
 * default (env var absent) ⇒ refused.
 */

import { runExecutionAdapter, type ExecutionContext, type AdapterRunResult } from "./execution-adapter.js";
import { rejectDraftsAdapter, type RejectDraftsStore } from "./adapters/reject-drafts.js";

export interface RejectDraftsProposal {
  id: string;
  status: ExecutionContext["status"];
  expiresAt: string | null;
}

/**
 * Run the gated reject-drafts action against an authorized proposal. `runExecutionAdapter`
 * enforces the fail-closed gate + the per-action allowlist flag BEFORE any write — pass
 * `dryRun:true` to only count (never write). Returns the adapter run result (incl. before/after).
 *
 * The store is injected (the pg executor store in production, a fake in tests); the executor
 * holds no DB key here. `now` is injected so the path is hermetic/testable.
 */
export async function runRejectDrafts(
  proposal: RejectDraftsProposal,
  env: Record<string, string | undefined>,
  opts: { now?: string; dryRun?: boolean; store: RejectDraftsStore; hasCapabilityToken?: boolean },
): Promise<AdapterRunResult> {
  const now = opts.now ?? new Date().toISOString();
  const store = opts.store;
  const ctx: ExecutionContext = {
    proposalId: proposal.id,
    status: proposal.status,
    expiresAt: proposal.expiresAt,
    now,
    // Write authorization = a capability token (Edge Function) OR the elevated Node DB credential
    // (the pg executor store). An explicit override wins when the caller knows.
    hasCapabilityToken: opts.hasCapabilityToken ?? Boolean(env.HARTOS_ASK_WRITE_TOKEN || env.HARTOS_SUPABASE_DB_URL),
    env,
  };
  const writeAudit = async (event: string, detail: string): Promise<void> => {
    // Framework-level trace; the DURABLE audit row is written by the adapter's stampSync.
    console.log(`[exec-audit] ${event}: ${detail}`);
  };

  if (opts.dryRun) {
    const outcome = await rejectDraftsAdapter.dryRun({ store, now, proposalId: proposal.id });
    await writeAudit("execution_dry_run", outcome.summary);
    return { adapterId: rejectDraftsAdapter.id, precondition: { allowed: true, denials: [] }, executed: false, outcome };
  }

  return runExecutionAdapter(rejectDraftsAdapter, ctx, {
    adapterDeps: { store, now, proposalId: proposal.id },
    writeAudit,
  });
}
