/**
 * src/execution/run-refresh-sync.ts — Phase 3: the LIVE refresh-sync executor.
 *
 * The Node host enforces the Phase 2.5 fail-closed gate (via `runExecutionAdapter`) and,
 * only when it passes, drives the action through the SAME capability-token Edge Function
 * the cockpit uses — so the executor holds NO DB/service key either. `mode:"count"` is the
 * dry-run read (no write); `mode:"expire"` does the conditional expire + the durable audit.
 */

import { runExecutionAdapter, type ExecutionContext, type AdapterRunResult } from "./execution-adapter.js";
import { refreshSyncAdapter, type RefreshSyncStore } from "./adapters/refresh-sync.js";

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** A RefreshSyncStore that reaches Supabase ONLY through the gated Edge Function (capability token). */
export function liveRefreshSyncStore(env: Record<string, string | undefined>, fetchImpl?: FetchLike): RefreshSyncStore {
  const url = env.HARTOS_ASK_WRITE_URL;
  const token = env.HARTOS_ASK_WRITE_TOKEN;
  const doFetch = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  async function call(mode: "count" | "expire"): Promise<{ count?: number; expired?: number }> {
    if (!url || !token) throw new Error("refresh-sync endpoint not configured (HARTOS_ASK_WRITE_URL/TOKEN)");
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ refresh_sync: { mode } }),
    });
    if (!res.ok) throw new Error(`refresh-sync ${mode} failed (${res.status})`);
    return (await res.json()) as { count?: number; expired?: number };
  }
  return {
    async countStaleProposals() { return (await call("count")).count ?? 0; },
    async expireStaleProposals() { return (await call("expire")).expired ?? 0; },
    async stampSync() { /* the Edge Function's expire op writes the durable audit row */ },
  };
}

export interface RefreshSyncProposal {
  id: string;
  status: ExecutionContext["status"];
  expiresAt: string | null;
}

/**
 * Run the gated refresh-sync against an authorized proposal. `runExecutionAdapter`
 * enforces the gate + the per-action allowlist flag BEFORE any write — pass `dryRun:true`
 * to only count (never write). Returns the adapter run result (incl. before/after).
 */
export async function runRefreshSync(
  proposal: RefreshSyncProposal,
  env: Record<string, string | undefined>,
  opts: { now?: string; fetchImpl?: FetchLike; dryRun?: boolean; store?: RefreshSyncStore; hasCapabilityToken?: boolean } = {},
): Promise<AdapterRunResult> {
  const now = opts.now ?? new Date().toISOString();
  const ctx: ExecutionContext = {
    proposalId: proposal.id,
    status: proposal.status,
    expiresAt: proposal.expiresAt,
    now,
    // Write authorization = a capability token (Edge Function) OR the elevated Node DB
    // credential (the pg executor store). An explicit override wins when the caller knows.
    hasCapabilityToken: opts.hasCapabilityToken ?? Boolean(env.HARTOS_ASK_WRITE_TOKEN || env.HARTOS_SUPABASE_DB_URL),
    env,
  };
  // Default transport is the capability-token Edge Function; callers may inject the pg store.
  const store = opts.store ?? liveRefreshSyncStore(env, opts.fetchImpl);
  const writeAudit = async (event: string, detail: string): Promise<void> => {
    // Framework-level trace; the DURABLE audit row is written by the Edge Function's expire op.
    console.log(`[exec-audit] ${event}: ${detail}`);
  };
  if (opts.dryRun) {
    const outcome = await refreshSyncAdapter.dryRun({ store, now, proposalId: proposal.id });
    await writeAudit("execution_dry_run", outcome.summary);
    return { adapterId: refreshSyncAdapter.id, precondition: { allowed: true, denials: [] }, executed: false, outcome };
  }
  return runExecutionAdapter(refreshSyncAdapter, ctx, { adapterDeps: { store, now, proposalId: proposal.id }, writeAudit });
}
