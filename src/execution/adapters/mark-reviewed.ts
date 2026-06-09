/**
 * src/execution/adapters/mark-reviewed.ts — plan §14: a T2 gated ops-mirror action.
 *
 * Effect — ALL in HartOS's OWN Supabase, zero external blast radius: mark every ops-domain
 * proposal as reviewed (queue hygiene for the ops mirror) and stamp a sync record. T2
 * (ops-mirror) — it adds READ-BEFORE-WRITE over the T0 cleanup shape: before the write the
 * action captures a `beforeState` snapshot of the rows it is about to touch (the honest tier
 * story proposal-tiering demands for T2). "Reviewed" is a REVERSIBLE jsonb marker —
 * `payload.reviewed=true` — NOT a new lifecycle status: no migration, no enum change.
 * Reversible (clear the marker to un-review) and idempotent (a re-run marks nothing new,
 * because every targeted row already carries the marker). It never writes to ClickUp /
 * Telegram / any external system. All I/O goes through an injected store, so the action is
 * unit-testable and the LIVE store uses the elevated Node DB credential — never the read-only
 * Worker. Mirrors archive-rejected exactly; the differences are the marker (`payload.reviewed`),
 * the target filter (`domain='ops'` not-yet-reviewed), and the T2 beforeState read.
 */

import type { ExecutionAdapter, ExecutionOutcome } from "../execution-adapter.js";

/** A read-before-write snapshot of a single target row (the T2 honesty requirement). */
export interface ReviewableSnapshot {
  id: string;
  status: string | null;
  /** The row's current payload jsonb (pre-write) — proves `reviewed` was not yet set. */
  payload: Record<string, unknown> | null;
}

export interface MarkReviewedStore {
  /** Count `domain='ops'` proposals not yet marked `payload.reviewed=true` — the only rows this action may touch. */
  countReviewableOps(now: string): Promise<number>;
  /** Read a beforeState snapshot of the reviewable ops rows (read-before-write — T2). No writes. */
  readReviewableOps(now: string): Promise<ReviewableSnapshot[]>;
  /** Mark every reviewable ops proposal with the reversible jsonb flag (returns the count marked). */
  markReviewedProposals(now: string): Promise<number>;
  /** Stamp a sync record (the triggering proposal id, now, the reviewed count). */
  stampSync(proposalId: string, now: string, reviewed: number): Promise<void>;
}

export interface MarkReviewedDeps {
  store: MarkReviewedStore;
  now: string;
  proposalId: string;
}

/** Per-action allowlist flag — absent by default, so this action is OFF until enabled. */
export const MARK_REVIEWED_FLAG = "ALLOW_EXEC_MARK_REVIEWED";

export const markReviewedAdapter: ExecutionAdapter<MarkReviewedDeps> = {
  id: "mark-reviewed",
  allowlistFlag: MARK_REVIEWED_FLAG,

  async dryRun(deps): Promise<ExecutionOutcome> {
    const reviewable = await deps.store.countReviewableOps(deps.now);
    return {
      ran: false,
      reversible: true,
      before: { reviewableOps: reviewable },
      after: { reviewableOps: reviewable },
      summary: `Dry-run: would mark ${reviewable} ops proposal(s) reviewed via the reversible payload.reviewed marker and stamp a sync record. No writes performed.`,
    };
  },

  async execute(deps): Promise<ExecutionOutcome> {
    // T2 read-before-write: capture the current snapshot of the rows we are about to touch
    // BEFORE any write, so before/after is a real diff and the tier story is honest.
    const beforeState = await deps.store.readReviewableOps(deps.now);
    const before = beforeState.length;
    const reviewed = await deps.store.markReviewedProposals(deps.now);
    await deps.store.stampSync(deps.proposalId, deps.now, reviewed);
    const after = await deps.store.countReviewableOps(deps.now);
    return {
      ran: true,
      reversible: true,
      before: { reviewableOps: before, beforeState },
      after: { reviewableOps: after },
      summary: `Marked ${reviewed} ops proposal(s) reviewed via the reversible payload.reviewed marker; stamped sync. Read-before-write captured a beforeState snapshot of ${beforeState.length} row(s). Touches only HartOS's own queue; correction = clear payload.reviewed; an idempotent re-run marks 0.`,
    };
  },
};
