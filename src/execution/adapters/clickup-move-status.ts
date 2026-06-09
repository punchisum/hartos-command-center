/**
 * src/execution/adapters/clickup-move-status.ts — §14: the external (T3) state transition.
 *
 * Effect — moves ONE ClickUp card from a known current status to a target status, but ONLY
 * through an APPROVED transition and ONLY after a read-before-write confirmation of the live
 * target status. This is the highest pre-nuclear (pre-T4) tier: a reversible external state
 * change carrying the FULL T3 payload by construction:
 *   • read-before-write — the card's LIVE status is re-read first; the write proceeds ONLY if
 *     it still equals the asserted `fromStatus`. If someone else already moved it (live != from),
 *     or the card is gone, it REFUSES and writes nothing — never on an unconfirmed target,
 *   • approved-transition allowlist — a (from → to) pair not on `APPROVED_CLICKUP_TRANSITIONS`
 *     is refused; HartOS moves cards only through transitions Hart pre-approved,
 *   • idempotency — if the card is ALREADY in `toStatus`, this is a no-op (a re-run moves 0),
 *   • before/after — { status: from } → { status: to },
 *   • dry-run — read-only: confirm target + current status, report what WOULD move, write nothing,
 *   • correction note — how to undo (move the card back from `toStatus` to `fromStatus`).
 *
 * All I/O goes through an injected `ClickUpMoveStore` (fake in tests, the token-bearing live
 * client on the Node host — never the Worker, never logged). Reversible (move back) and idempotent.
 * Gated like every adapter: its own allowlist flag (default OFF) under the global kill-switch.
 */

import type { ExecutionAdapter, ExecutionOutcome } from "../execution-adapter.js";

/** A ClickUp card with its current status — the read-before-write target snapshot. */
export interface ClickUpCardStatus {
  id: string;
  name: string;
  status: string;
}

export interface ClickUpMoveStore {
  /** Read-before-write: the live card incl. its current status, or null if it does not exist. */
  getCard(cardId: string): Promise<ClickUpCardStatus | null>;
  /** Move the card to `toStatus`. Called ONLY after the live read confirmed `fromStatus`. */
  moveCard(cardId: string, toStatus: string): Promise<void>;
}

export interface ClickUpMoveDeps {
  store: ClickUpMoveStore;
  cardId: string;
  cardName: string;
  /** The status the card is asserted to be in NOW (verified by the live read before any write). */
  fromStatus: string;
  /** The status to move it to — must form an approved transition with `fromStatus`. */
  toStatus: string;
}

/** Per-action allowlist flag — absent by default, so this action is OFF until enabled. */
export const CLICKUP_MOVE_FLAG = "ALLOW_EXEC_CLICKUP_MOVE";

/**
 * The transitions Hart pre-approved for HartOS to drive. HartOS never invents a transition;
 * a (from → to) not in this set is refused. Compared case/whitespace-insensitively via
 * `normalizeStatus`. Kept deliberately small + conservative — widen only with Hart's say-so.
 */
export const APPROVED_CLICKUP_TRANSITIONS: ReadonlyArray<{ from: string; to: string }> = [
  { from: "waiting on hart", to: "in progress" },
  { from: "in progress", to: "in review" },
  { from: "in review", to: "complete" },
  // On-hold parking (added at Hart's explicit request — safe + reversible: a stalled item is
  // parked, never deleted, and the resume transition restores it). Every active state can be
  // put on hold; on-hold resumes to "in progress".
  { from: "waiting on hart", to: "on hold" },
  { from: "in progress", to: "on hold" },
  { from: "in review", to: "on hold" },
  { from: "on hold", to: "in progress" },
];

/** Normalize a status for comparison (lowercased, single-spaced, trimmed). */
export function normalizeStatus(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True iff (from → to) is an approved transition. */
export function isApprovedTransition(fromStatus: string, toStatus: string): boolean {
  const from = normalizeStatus(fromStatus);
  const to = normalizeStatus(toStatus);
  return APPROVED_CLICKUP_TRANSITIONS.some((t) => normalizeStatus(t.from) === from && normalizeStatus(t.to) === to);
}

/** How a move is undone — surfaced as the T3 correction note. */
function correctionNote(cardId: string, fromStatus: string, toStatus: string): string {
  return `Correction: move card ${cardId} back ${toStatus} → ${fromStatus} to undo.`;
}

export const clickupMoveStatusAdapter: ExecutionAdapter<ClickUpMoveDeps> = {
  id: "clickup-move-status",
  allowlistFlag: CLICKUP_MOVE_FLAG,

  async dryRun(deps): Promise<ExecutionOutcome> {
    const card = await deps.store.getCard(deps.cardId);
    if (!card) {
      return refused(`ClickUp card ${deps.cardId} not found`, deps.fromStatus, deps.toStatus, true);
    }
    const live = normalizeStatus(card.status);
    if (live === normalizeStatus(deps.toStatus)) {
      return noop(`already in "${deps.toStatus}"`, card.status, deps.toStatus);
    }
    if (live !== normalizeStatus(deps.fromStatus)) {
      return refused(
        `live status "${card.status}" != asserted from "${deps.fromStatus}" (target changed underneath us)`,
        card.status,
        deps.toStatus,
        true,
      );
    }
    if (!isApprovedTransition(deps.fromStatus, deps.toStatus)) {
      return refused(`transition "${deps.fromStatus}" → "${deps.toStatus}" is not approved`, card.status, deps.toStatus, true);
    }
    return {
      ran: false,
      reversible: true,
      before: { status: card.status },
      after: { status: deps.toStatus },
      summary: `Dry-run: would move card "${card.name}" (${deps.cardId}) ${deps.fromStatus} → ${deps.toStatus}. No write performed.`,
    };
  },

  async execute(deps): Promise<ExecutionOutcome> {
    // 1) Read-before-write: re-read the LIVE card. No card ⇒ refuse, write nothing.
    const card = await deps.store.getCard(deps.cardId);
    if (!card) {
      return refused(`ClickUp card ${deps.cardId} not found`, deps.fromStatus, deps.toStatus, false);
    }
    const live = normalizeStatus(card.status);

    // 2) Idempotency: already in the target status ⇒ no-op (a re-run moves 0).
    if (live === normalizeStatus(deps.toStatus)) {
      return noop(`already in "${deps.toStatus}"; an idempotent re-run moves 0`, card.status, deps.toStatus);
    }

    // 3) Read-before-write guard: the card must STILL be in the asserted `fromStatus`.
    if (live !== normalizeStatus(deps.fromStatus)) {
      return refused(
        `live status "${card.status}" != asserted from "${deps.fromStatus}" — refusing to move a target that changed underneath us`,
        card.status,
        deps.toStatus,
        false,
      );
    }

    // 4) Approved-transition allowlist: never invent a transition.
    if (!isApprovedTransition(deps.fromStatus, deps.toStatus)) {
      return refused(`transition "${deps.fromStatus}" → "${deps.toStatus}" is not approved`, card.status, deps.toStatus, false);
    }

    // 5) The single external write — reversible (move back via the correction note).
    await deps.store.moveCard(deps.cardId, deps.toStatus);
    const confirmed = await deps.store.getCard(deps.cardId);
    return {
      ran: true,
      reversible: true,
      before: { status: card.status },
      after: { status: confirmed?.status ?? deps.toStatus },
      summary: `Moved card "${card.name}" (${deps.cardId}) ${deps.fromStatus} → ${deps.toStatus}. ${correctionNote(deps.cardId, deps.fromStatus, deps.toStatus)}`,
    };
  },
};

/** A no-write refusal outcome (target unconfirmed / transition not approved). */
function refused(reason: string, fromStatus: string, toStatus: string, dry: boolean): ExecutionOutcome {
  return {
    ran: false,
    reversible: true,
    before: { status: fromStatus },
    after: { status: fromStatus },
    summary: `${dry ? "Dry-run REFUSED" : "REFUSED"}: ${reason}. No write performed.`,
  };
}

/** An idempotent no-op outcome (the card is already where we'd move it). */
function noop(reason: string, currentStatus: string, toStatus: string): ExecutionOutcome {
  return {
    ran: false,
    reversible: true,
    before: { status: currentStatus },
    after: { status: currentStatus },
    summary: `No-op: ${reason}.`,
  };
}
