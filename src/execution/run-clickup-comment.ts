/**
 * src/execution/run-clickup-comment.ts — §14: the gated clickup-comment executor.
 *
 * The Node host enforces the Phase 2.5 fail-closed gate (via `runExecutionAdapter`) and, only
 * when it passes, drives the action through the injected store. `dryRun:true` is the read-only
 * preview (confirm target + idempotency; no write); the real path confirms the target, skips on
 * an existing idempotent comment, else posts exactly one comment.
 *
 * The read-before-write target confirmation + idempotency live INSIDE the adapter (they are
 * properties of the EXTERNAL target, not of the authorizing proposal). The proposal-level
 * authorization (approved_for_execution + capability token + audit + the per-action allowlist
 * flag) is still the only way it may run. Flag OFF by default (env var absent) ⇒ refused.
 *
 * Node/Edge ONLY — the live store carries the ClickUp token, which never enters the Worker.
 */

import { runExecutionAdapter, type ExecutionContext, type AdapterRunResult } from "./execution-adapter.js";
import { clickupCommentAdapter, type ClickUpCommentStore } from "./adapters/clickup-comment.js";
import { makeIdempotencyKey } from "../lib/idempotency-key.js";

export interface ClickUpCommentProposal {
  id: string;
  status: ExecutionContext["status"];
  expiresAt: string | null;
}

export interface ClickUpCommentTarget {
  cardId: string;
  cardName: string;
  commentText: string;
}

/**
 * Build the deterministic idempotency key from TRUSTED fields only (the card id + the
 * authorizing proposal id) — never the LLM/human comment text (idempotency-key.ts rule 2).
 * Same proposal + same card ⇒ same key ⇒ a re-run posts no duplicate.
 */
export function clickupCommentIdempotencyKey(cardId: string, proposalId: string): string {
  return makeIdempotencyKey([cardId, "clickup-comment", proposalId]);
}

/**
 * Run the gated clickup-comment action against an authorized proposal. `runExecutionAdapter`
 * enforces the fail-closed gate + the per-action allowlist flag BEFORE any write — pass
 * `dryRun:true` to only preview (never write). Returns the adapter run result (incl. before/after).
 *
 * The store is injected (the token-bearing live ClickUp client in production, a fake in tests);
 * the executor holds no token here. `now` is injected so the path is hermetic/testable.
 */
export async function runClickUpComment(
  proposal: ClickUpCommentProposal,
  target: ClickUpCommentTarget,
  env: Record<string, string | undefined>,
  opts: { now?: string; dryRun?: boolean; store: ClickUpCommentStore; hasCapabilityToken?: boolean },
): Promise<AdapterRunResult> {
  const now = opts.now ?? new Date().toISOString();
  const store = opts.store;
  const idempotencyKey = clickupCommentIdempotencyKey(target.cardId, proposal.id);
  const ctx: ExecutionContext = {
    proposalId: proposal.id,
    status: proposal.status,
    expiresAt: proposal.expiresAt,
    now,
    // Write authorization = a capability token (the elevated ClickUp token on the Node host).
    // An explicit override wins when the caller knows.
    hasCapabilityToken: opts.hasCapabilityToken ?? Boolean(env.CLICKUP_API_TOKEN),
    env,
  };
  const adapterDeps = {
    store,
    cardId: target.cardId,
    cardName: target.cardName,
    commentText: target.commentText,
    idempotencyKey,
  };
  const writeAudit = async (event: string, detail: string): Promise<void> => {
    // Framework-level trace; the durable audit row is written by the proposal spine.
    console.log(`[exec-audit] ${event}: ${detail}`);
  };

  if (opts.dryRun) {
    const outcome = await clickupCommentAdapter.dryRun(adapterDeps);
    await writeAudit("execution_dry_run", outcome.summary);
    return { adapterId: clickupCommentAdapter.id, precondition: { allowed: true, denials: [] }, executed: false, outcome };
  }

  return runExecutionAdapter(clickupCommentAdapter, ctx, { adapterDeps, writeAudit });
}
