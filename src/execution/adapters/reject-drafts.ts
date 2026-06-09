/**
 * src/execution/adapters/reject-drafts.ts — plan §14: a T0 gated cleanup action.
 *
 * Effect — ALL in HartOS's OWN Supabase, zero external blast radius: reject every proposal
 * still in `draft` (queue hygiene) and stamp a sync record. T0 (internal low-risk cleanup):
 * reversible (a rejected draft can be re-drafted) and idempotent (a re-run rejects nothing
 * new, because no `draft` rows remain). It never writes to ClickUp / Telegram / any external
 * system. All I/O goes through an injected store, so the action is unit-testable and the LIVE
 * store uses the elevated Node DB credential — never the read-only Worker. Mirrors refresh-sync
 * exactly; the only difference is the target filter (bulk-by-status `status='draft'`), so there
 * is no single-row live-status verification branch.
 */

import type { ExecutionAdapter, ExecutionOutcome } from "../execution-adapter.js";

export interface RejectDraftsStore {
  /** Count proposals still in `draft` — the only rows this action may touch. */
  countRejectableDrafts(now: string): Promise<number>;
  /** Reject every `draft` proposal (conditional write; returns the count rejected). */
  rejectDraftProposals(now: string): Promise<number>;
  /** Stamp a sync record (the triggering proposal id, now, the rejected count). */
  stampSync(proposalId: string, now: string, rejected: number): Promise<void>;
}

export interface RejectDraftsDeps {
  store: RejectDraftsStore;
  now: string;
  proposalId: string;
}

/** Per-action allowlist flag — absent by default, so this action is OFF until enabled. */
export const REJECT_DRAFTS_FLAG = "ALLOW_EXEC_REJECT_DRAFTS";

export const rejectDraftsAdapter: ExecutionAdapter<RejectDraftsDeps> = {
  id: "reject-drafts",
  allowlistFlag: REJECT_DRAFTS_FLAG,

  async dryRun(deps): Promise<ExecutionOutcome> {
    const drafts = await deps.store.countRejectableDrafts(deps.now);
    return {
      ran: false,
      reversible: true,
      before: { draftProposals: drafts },
      after: { draftProposals: drafts },
      summary: `Dry-run: would reject ${drafts} draft proposal(s) and stamp a sync record. No writes performed.`,
    };
  },

  async execute(deps): Promise<ExecutionOutcome> {
    const before = await deps.store.countRejectableDrafts(deps.now);
    const rejected = await deps.store.rejectDraftProposals(deps.now);
    await deps.store.stampSync(deps.proposalId, deps.now, rejected);
    const after = await deps.store.countRejectableDrafts(deps.now);
    return {
      ran: true,
      reversible: true,
      before: { draftProposals: before },
      after: { draftProposals: after },
      summary: `Rejected ${rejected} draft proposal(s); stamped sync. Touches only HartOS's own queue; an idempotent re-run rejects 0.`,
    };
  },
};
