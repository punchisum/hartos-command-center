/**
 * src/execution/adapters/clickup-comment.ts — §14: the FIRST external (T3) mutation.
 *
 * Effect — adds ONE comment to a ClickUp card. This is the lightest external write
 * (purely additive, never destructive) and the first time HartOS touches a system OUTSIDE
 * its own Supabase. T3 (external) therefore carries the FULL payload by construction:
 *   • read-before-write target confirmation — the card is re-read first; a missing card is
 *     refused (never write to an unconfirmed target),
 *   • idempotency — every comment embeds a deterministic `hartos-idem` marker, and a re-run
 *     that finds that marker already present posts NOTHING (no duplicate comment),
 *   • before/after — comment count before vs. after,
 *   • dry-run — a read-only path that confirms the target + idempotency and reports what
 *     WOULD be posted, writing nothing,
 *   • correction note — how a (future) mutation is undone (delete the created comment).
 *
 * All I/O goes through an injected `ClickUpCommentStore`, so the action is unit-testable with
 * a fake client and NO network. The LIVE store (clickup-client.ts) carries the ClickUp token —
 * which lives ONLY on the Node execution host, NEVER in the read-only Worker, and is never
 * logged. Reversible (delete the comment) and idempotent (a re-run posts 0). Gated like every
 * adapter: its own allowlist flag (default OFF) under the global kill-switch — nothing posts
 * until the flag is deliberately, narrowly enabled.
 */

import type { ExecutionAdapter, ExecutionOutcome } from "../execution-adapter.js";

/** A ClickUp card as far as this action cares — id + human name (for the Mutation Center). */
export interface ClickUpCard {
  id: string;
  name: string;
}

export interface ClickUpCommentStore {
  /** Read-before-write target confirmation: the live card, or null if it does not exist. */
  getCard(cardId: string): Promise<ClickUpCard | null>;
  /** Idempotency check: an existing comment already carrying this idempotency key, or null. */
  findCommentByIdempotencyKey(cardId: string, idempotencyKey: string): Promise<{ id: string } | null>;
  /** Count the comments on the card (for honest before/after numbers). */
  countComments(cardId: string): Promise<number>;
  /** Post the comment; the live store embeds the idempotency marker. Returns the new comment id. */
  addComment(cardId: string, text: string, idempotencyKey: string): Promise<{ id: string }>;
}

export interface ClickUpCommentDeps {
  store: ClickUpCommentStore;
  cardId: string;
  cardName: string;
  /** The (already-built, human-authored or templated) comment body to post. */
  commentText: string;
  /** Deterministic key from trusted fields only (built by the runner via makeIdempotencyKey). */
  idempotencyKey: string;
}

/** Per-action allowlist flag — absent by default, so this action is OFF until enabled. */
export const CLICKUP_COMMENT_FLAG = "ALLOW_EXEC_CLICKUP_COMMENT";

/** How a posted comment is undone — surfaced as the T3 correction note. */
function correctionNote(commentId: string): string {
  return `Correction: delete ClickUp comment ${commentId} (DELETE /comment/${commentId}) to undo.`;
}

export const clickupCommentAdapter: ExecutionAdapter<ClickUpCommentDeps> = {
  id: "clickup-comment",
  allowlistFlag: CLICKUP_COMMENT_FLAG,

  async dryRun(deps): Promise<ExecutionOutcome> {
    // Read-only: confirm the target exists + whether the idempotent comment already landed.
    const card = await deps.store.getCard(deps.cardId);
    if (!card) {
      return {
        ran: false,
        reversible: true,
        before: { cardFound: false },
        after: { cardFound: false },
        summary: `Dry-run REFUSED: ClickUp card ${deps.cardId} not found — never write to an unconfirmed target.`,
      };
    }
    const existing = await deps.store.findCommentByIdempotencyKey(deps.cardId, deps.idempotencyKey);
    const count = await deps.store.countComments(deps.cardId);
    if (existing) {
      return {
        ran: false,
        reversible: true,
        before: { comments: count, idempotentCommentPresent: true },
        after: { comments: count, idempotentCommentPresent: true },
        summary: `Dry-run: comment already present on "${card.name}" (idempotency ${deps.idempotencyKey}) — would post nothing.`,
      };
    }
    return {
      ran: false,
      reversible: true,
      before: { comments: count, idempotentCommentPresent: false },
      after: { comments: count + 1, idempotentCommentPresent: true },
      summary: `Dry-run: would add 1 comment to ClickUp card "${card.name}" (${deps.cardId}). No write performed.`,
    };
  },

  async execute(deps): Promise<ExecutionOutcome> {
    // 1) Read-before-write target confirmation. No card ⇒ refuse, write nothing.
    const card = await deps.store.getCard(deps.cardId);
    if (!card) {
      return {
        ran: false,
        reversible: true,
        before: { cardFound: false },
        after: { cardFound: false },
        summary: `REFUSED: ClickUp card ${deps.cardId} not found — never write to an unconfirmed target.`,
      };
    }

    // 2) Idempotency: if the marked comment already exists, this is a no-op (no duplicate).
    const existing = await deps.store.findCommentByIdempotencyKey(deps.cardId, deps.idempotencyKey);
    const before = await deps.store.countComments(deps.cardId);
    if (existing) {
      return {
        ran: false,
        reversible: true,
        before: { comments: before, idempotentCommentPresent: true },
        after: { comments: before, idempotentCommentPresent: true },
        summary: `No-op: comment ${existing.id} already present on "${card.name}" (idempotency ${deps.idempotencyKey}); an idempotent re-run posts 0.`,
      };
    }

    // 3) The single external write — additive, reversible.
    const posted = await deps.store.addComment(deps.cardId, deps.commentText, deps.idempotencyKey);
    const after = await deps.store.countComments(deps.cardId);
    return {
      ran: true,
      reversible: true,
      before: { comments: before, idempotentCommentPresent: false },
      after: { comments: after, idempotentCommentPresent: true, commentId: posted.id },
      summary: `Added comment ${posted.id} to ClickUp card "${card.name}" (${deps.cardId}). ${correctionNote(posted.id)}`,
    };
  },
};
