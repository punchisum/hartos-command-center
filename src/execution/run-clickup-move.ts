/**
 * src/execution/run-clickup-move.ts — §14: the gated clickup-move-status executor.
 *
 * The Node host enforces the Phase 2.5 fail-closed gate (via `runExecutionAdapter`) and, only
 * when it passes, drives the action through the injected store. `dryRun:true` is the read-only
 * preview (confirm target + current status + approved transition; no write); the real path
 * re-reads the live status, refuses on a target that changed underneath us or an unapproved
 * transition, no-ops if already in the target, else moves the card exactly once.
 *
 * The read-before-write LIVE target-status verification + the approved-transition allowlist live
 * INSIDE the adapter (they are properties of the EXTERNAL card, not the authorizing proposal).
 * The proposal-level authorization (approved_for_execution + capability token + audit + the
 * per-action allowlist flag) is still the only way it may run. Flag OFF by default ⇒ refused.
 *
 * Node/Edge ONLY — the live store carries the ClickUp token, which never enters the Worker.
 */

import { runExecutionAdapter, type ExecutionContext, type AdapterRunResult } from "./execution-adapter.js";
import { clickupMoveStatusAdapter, type ClickUpMoveStore } from "./adapters/clickup-move-status.js";
import { makeIdempotencyKey } from "../lib/idempotency-key.js";

export interface ClickUpMoveProposal {
  id: string;
  status: ExecutionContext["status"];
  expiresAt: string | null;
}

export interface ClickUpMoveTarget {
  cardId: string;
  cardName: string;
  fromStatus: string;
  toStatus: string;
}

/**
 * Deterministic key from TRUSTED fields only (card id + the two statuses) — never LLM text.
 * The move is structurally idempotent (already-in-target = no-op); the key exists for the
 * audit/Mutation-Center record and same-batch duplicate detection.
 */
export function clickupMoveIdempotencyKey(cardId: string, fromStatus: string, toStatus: string): string {
  return makeIdempotencyKey([cardId, "clickup-move", fromStatus, toStatus]);
}

/**
 * Run the gated clickup-move-status action against an authorized proposal. `runExecutionAdapter`
 * enforces the fail-closed gate + the per-action allowlist flag BEFORE any write — pass
 * `dryRun:true` to only preview (never write). Returns the adapter run result (incl. before/after).
 *
 * The store is injected (the token-bearing live ClickUp client in production, a fake in tests);
 * the executor holds no token here. `now` is injected so the path is hermetic/testable.
 */
export async function runClickUpMove(
  proposal: ClickUpMoveProposal,
  target: ClickUpMoveTarget,
  env: Record<string, string | undefined>,
  opts: { now?: string; dryRun?: boolean; store: ClickUpMoveStore; hasCapabilityToken?: boolean },
): Promise<AdapterRunResult> {
  const now = opts.now ?? new Date().toISOString();
  const store = opts.store;
  const ctx: ExecutionContext = {
    proposalId: proposal.id,
    status: proposal.status,
    expiresAt: proposal.expiresAt,
    now,
    hasCapabilityToken: opts.hasCapabilityToken ?? Boolean(env.CLICKUP_API_TOKEN),
    env,
  };
  const adapterDeps = {
    store,
    cardId: target.cardId,
    cardName: target.cardName,
    fromStatus: target.fromStatus,
    toStatus: target.toStatus,
  };
  const writeAudit = async (event: string, detail: string): Promise<void> => {
    console.log(`[exec-audit] ${event}: ${detail}`);
  };

  if (opts.dryRun) {
    const outcome = await clickupMoveStatusAdapter.dryRun(adapterDeps);
    await writeAudit("execution_dry_run", outcome.summary);
    return { adapterId: clickupMoveStatusAdapter.id, precondition: { allowed: true, denials: [] }, executed: false, outcome };
  }

  return runExecutionAdapter(clickupMoveStatusAdapter, ctx, { adapterDeps, writeAudit });
}
