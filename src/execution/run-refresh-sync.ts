/**
 * src/execution/run-refresh-sync.ts — Phase 3: the LIVE refresh-sync executor.
 *
 * The Node host enforces the Phase 2.5 fail-closed gate (via `runExecutionAdapter`) and,
 * only when it passes, drives the action through the SAME capability-token Edge Function
 * the cockpit uses — so the executor holds NO DB/service key either. `mode:"count"` is the
 * dry-run read (no write); `mode:"expire"` does the conditional expire + the durable audit;
 * `mode:"status"` is the Level-0 read-only live-status verification (no write).
 */

import { runExecutionAdapter, type ExecutionContext, type AdapterRunResult } from "./execution-adapter.js";
import { refreshSyncAdapter, type RefreshSyncStore } from "./adapters/refresh-sync.js";
import { checkExecutionPrecondition, EXECUTABLE_FROM } from "../doctrine/execution-gate.js";
import type { LiveProposalStatus, VerifyingRefreshSyncStore } from "./run-refresh-sync-db.js";

/** A store that can re-read the live target status (the pg executor store or the Edge store). */
function canVerify(store: RefreshSyncStore): store is VerifyingRefreshSyncStore {
  return typeof (store as Partial<VerifyingRefreshSyncStore>).getLiveProposalStatus === "function";
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** A VerifyingRefreshSyncStore that reaches Supabase ONLY through the gated Edge Function (capability token). */
export function liveRefreshSyncStore(env: Record<string, string | undefined>, fetchImpl?: FetchLike): VerifyingRefreshSyncStore {
  const url = env.HARTOS_ASK_WRITE_URL;
  const token = env.HARTOS_ASK_WRITE_TOKEN;
  const doFetch = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  async function call(
    payload: { mode: "count" | "expire" } | { mode: "status"; id: string },
  ): Promise<{ count?: number; expired?: number; found?: boolean; status?: string | null; expires_at?: string | null }> {
    if (!url || !token) throw new Error("refresh-sync endpoint not configured (HARTOS_ASK_WRITE_URL/TOKEN)");
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ refresh_sync: payload }),
    });
    if (!res.ok) throw new Error(`refresh-sync ${payload.mode} failed (${res.status})`);
    return (await res.json()) as { count?: number; expired?: number; found?: boolean; status?: string | null; expires_at?: string | null };
  }
  return {
    async getLiveProposalStatus(proposalId: string): Promise<LiveProposalStatus | null> {
      // Read-only live-status verification over the SAME capability-token Edge Function.
      const r = await call({ mode: "status", id: proposalId });
      if (!r.found) return null;
      return { status: r.status ?? "", expiresAt: r.expires_at ?? null };
    },
    async countStaleProposals() { return (await call({ mode: "count" })).count ?? 0; },
    async expireStaleProposals() { return (await call({ mode: "expire" })).expired ?? 0; },
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
 *
 * Level-0 hardening (plan §1/§10): on the real (non-dry-run) path, BEFORE handing off to
 * `runExecutionAdapter`, this re-reads the LIVE proposal row over the same transport and
 * compares it against `EXECUTABLE_FROM` and the asserted status. A mismatch / missing row /
 * read failure refuses + audits HERE — it never reaches the adapter — so a write can never
 * proceed on an unconfirmed status. The verified result is also threaded into the precondition
 * as `liveStatusVerified`. The read never crashes open: any error → refusal.
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

  // Real path: live status verification (read-before-write). The store re-reads the row; a
  // missing row, a read error, or any mismatch against EXECUTABLE_FROM/the asserted status
  // refuses here — BEFORE the adapter — so nothing is ever written on an unconfirmed status.
  let live: LiveProposalStatus | null = null;
  let liveReadError: string | null = null;
  if (canVerify(store)) {
    try {
      live = await store.getLiveProposalStatus(proposal.id);
    } catch (err) {
      liveReadError = err instanceof Error ? err.message : "live status read failed";
    }
  } else {
    liveReadError = "store cannot verify live status (no getLiveProposalStatus)";
  }
  const liveStatusVerified =
    !liveReadError &&
    live != null &&
    live.status === EXECUTABLE_FROM &&
    live.status === proposal.status;

  if (!liveStatusVerified) {
    // Refuse + audit HERE (never crash open). Mirror the gate's denial via a pure gate call so
    // the returned precondition carries the live-status denial reason.
    const detail = liveReadError
      ? `live status read failed: ${liveReadError}`
      : live == null
        ? `live proposal ${proposal.id} not found`
        : `live status "${live.status}" != asserted "${proposal.status}"/required "${EXECUTABLE_FROM}"`;
    await writeAudit("execution_refused", `live status not verified — ${detail}`);
    const precondition = checkExecutionPrecondition({
      // The asserted status keeps the gate input well-typed; `liveStatusVerified:false` is the
      // load-bearing denial here regardless of the row's exact value.
      status: proposal.status,
      expiresAt: proposal.expiresAt,
      now,
      hasCapabilityToken: ctx.hasCapabilityToken,
      auditEntryWritten: true,
      actionAllowlisted: false,
      liveStatusVerified: false,
    });
    return { adapterId: refreshSyncAdapter.id, precondition, executed: false, outcome: null };
  }

  return runExecutionAdapter(refreshSyncAdapter, ctx, {
    adapterDeps: { store, now, proposalId: proposal.id },
    writeAudit,
  });
}
