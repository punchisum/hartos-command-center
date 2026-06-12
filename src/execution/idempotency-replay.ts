/**
 * src/execution/idempotency-replay.ts — P3: pre-dispatch idempotency-replay enforcement (PURE).
 *
 * The external adapters are already STRUCTURALLY idempotent (read-before-write → no-op if the
 * target is already reached). This module adds the PRE-dispatch skip the Phase-3 audit flagged as
 * missing: derive a command's canonical idempotency key from TRUSTED fields only (via the canonical
 * lib/idempotency-key module — never LLM/human text) and decide whether re-dispatch is a replay,
 * either within this same batch (`seen`) or because it already landed in a prior run (`alreadyLanded`).
 *
 * Internal bulk adapters carry no per-row key (they are idempotent by their own read-before-write),
 * so they have a null key and are never replays. PURE: no I/O; the caller owns the key sets.
 */

import type { MutationCommand } from "./execution-dispatch.js";
import { clickupMoveIdempotencyKey } from "./run-clickup-move.js";
import { clickupCommentIdempotencyKey } from "./run-clickup-comment.js";

/**
 * The canonical idempotency key for a mutation command, or null when the adapter has no per-row
 * key (internal bulk adapters, idempotent by their own read-before-write). Built only from TRUSTED
 * fields via the per-adapter key functions (which wrap the canonical lib/idempotency-key module).
 */
export function idempotencyKeyForCommand(command: MutationCommand): string | null {
  try {
    switch (command.adapterId) {
      case "clickup-move-status":
        return clickupMoveIdempotencyKey(command.target.cardId, command.target.fromStatus, command.target.toStatus);
      case "clickup-comment":
        return clickupCommentIdempotencyKey(command.target.cardId, command.proposal.id);
      default:
        return null;
    }
  } catch {
    // The canonical module rejects untrusted/LLM-text key parts (e.g. an LLM-slug proposal id).
    // Fail safe: no trusted key ⇒ no replay claim — dispatch and let structural idempotency guard.
    return null;
  }
}

/**
 * True iff dispatching this key would be a replay — it was already executed in this batch (`seen`)
 * or already landed in a prior run (`alreadyLanded`). A null key (internal adapter) is never a
 * replay: those adapters guard themselves with a live read-before-write.
 */
export function isReplay(key: string | null, seen: Set<string>, alreadyLanded: Set<string>): boolean {
  if (key === null) return false;
  return seen.has(key) || alreadyLanded.has(key);
}
