/**
 * src/execution/adapters/archive-rejected.ts — plan §14: a T0 gated cleanup action.
 *
 * Effect — ALL in HartOS's OWN Supabase, zero external blast radius: archive every proposal
 * already in `rejected` (queue hygiene) and stamp a sync record. T0 (internal low-risk cleanup).
 * Archival is a REVERSIBLE jsonb marker — `payload.archived=true` — NOT a new lifecycle status:
 * no migration, no enum change. Reversible (clear the marker to un-archive) and idempotent (a
 * re-run archives nothing new, because every `rejected` row already carries the marker). It never
 * writes to ClickUp / Telegram / any external system. All I/O goes through an injected store, so
 * the action is unit-testable and the LIVE store uses the elevated Node DB credential — never the
 * read-only Worker. Mirrors refresh-sync exactly; the only difference is the target filter
 * (bulk-by-status: already-`rejected` rows not yet marked archived), so there is no single-row
 * live-status verification branch.
 */

import type { ExecutionAdapter, ExecutionOutcome } from "../execution-adapter.js";

export interface ArchiveRejectedStore {
  /** Count `rejected` proposals not yet marked `payload.archived=true` — the only rows this action may touch. */
  countArchivableRejected(now: string): Promise<number>;
  /** Mark every archivable `rejected` proposal with the reversible jsonb flag (returns the count archived). */
  archiveRejectedProposals(now: string): Promise<number>;
  /** Stamp a sync record (the triggering proposal id, now, the archived count). */
  stampSync(proposalId: string, now: string, archived: number): Promise<void>;
}

export interface ArchiveRejectedDeps {
  store: ArchiveRejectedStore;
  now: string;
  proposalId: string;
}

/** Per-action allowlist flag — absent by default, so this action is OFF until enabled. */
export const ARCHIVE_REJECTED_FLAG = "ALLOW_EXEC_ARCHIVE_REJECTED";

export const archiveRejectedAdapter: ExecutionAdapter<ArchiveRejectedDeps> = {
  id: "archive-rejected",
  allowlistFlag: ARCHIVE_REJECTED_FLAG,

  async dryRun(deps): Promise<ExecutionOutcome> {
    const archivable = await deps.store.countArchivableRejected(deps.now);
    return {
      ran: false,
      reversible: true,
      before: { archivableRejected: archivable },
      after: { archivableRejected: archivable },
      summary: `Dry-run: would archive ${archivable} rejected proposal(s) via the reversible payload.archived marker and stamp a sync record. No writes performed.`,
    };
  },

  async execute(deps): Promise<ExecutionOutcome> {
    const before = await deps.store.countArchivableRejected(deps.now);
    const archived = await deps.store.archiveRejectedProposals(deps.now);
    await deps.store.stampSync(deps.proposalId, deps.now, archived);
    const after = await deps.store.countArchivableRejected(deps.now);
    return {
      ran: true,
      reversible: true,
      before: { archivableRejected: before },
      after: { archivableRejected: after },
      summary: `Archived ${archived} rejected proposal(s) via the reversible payload.archived marker; stamped sync. Touches only HartOS's own queue; an idempotent re-run archives 0.`,
    };
  },
};
