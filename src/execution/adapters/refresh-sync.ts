/**
 * src/execution/adapters/refresh-sync.ts — Phase 3.1: the first safe action.
 *
 * Effect — ALL in HartOS's OWN Supabase, zero external blast radius: expire any past-due
 * proposals (queue hygiene) and stamp a sync record. Reversible-low-stakes (only touches
 * already-stale drafts) and idempotent (a re-run expires nothing new). It never writes to
 * ClickUp / Telegram / any external system. All I/O goes through an injected store, so the
 * action is unit-testable and the LIVE store uses the elevated Node DB credential — never
 * the read-only Worker.
 */

import type { ExecutionAdapter, ExecutionOutcome } from "../execution-adapter.js";

export interface RefreshSyncStore {
  /** Count proposals past their expiry that are still draft/pending. */
  countStaleProposals(now: string): Promise<number>;
  /** Expire past-due draft/pending proposals (conditional write; returns the count expired). */
  expireStaleProposals(now: string): Promise<number>;
  /** Stamp a sync record (refreshed_at, the triggering proposal id, the expired count). */
  stampSync(proposalId: string, now: string, expired: number): Promise<void>;
}

export interface RefreshSyncDeps {
  store: RefreshSyncStore;
  now: string;
  proposalId: string;
}

/** Per-action allowlist flag — absent by default, so this action is OFF until enabled. */
export const REFRESH_SYNC_FLAG = "ALLOW_EXEC_REFRESH_SYNC";

export const refreshSyncAdapter: ExecutionAdapter<RefreshSyncDeps> = {
  id: "refresh-sync",
  allowlistFlag: REFRESH_SYNC_FLAG,

  async dryRun(deps): Promise<ExecutionOutcome> {
    const stale = await deps.store.countStaleProposals(deps.now);
    return {
      ran: false,
      reversible: true,
      before: { staleProposals: stale },
      after: { staleProposals: stale },
      summary: `Dry-run: would expire ${stale} stale proposal(s) and stamp a sync record. No writes performed.`,
    };
  },

  async execute(deps): Promise<ExecutionOutcome> {
    const before = await deps.store.countStaleProposals(deps.now);
    const expired = await deps.store.expireStaleProposals(deps.now);
    await deps.store.stampSync(deps.proposalId, deps.now, expired);
    const after = await deps.store.countStaleProposals(deps.now);
    return {
      ran: true,
      reversible: true,
      before: { staleProposals: before },
      after: { staleProposals: after },
      summary: `Expired ${expired} stale proposal(s); stamped sync. Touches only HartOS's own queue; an idempotent re-run expires 0.`,
    };
  },
};
