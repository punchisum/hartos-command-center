/**
 * src/execution/rollback-proposal.ts — P4: generate a rollback PROPOSAL from an executed mutation.
 *
 * Requesting a rollback is itself only a proposal (status `rollback_pending_approval`) — it mutates
 * NOTHING. Hart still approves it, and the host rollback runner + every execution floor (gate +
 * ALLOW_EXEC_* + kill-switch + read-before-write) still decide whether the undo runs. The generated
 * proposal links its original (`rollbackOf`) and carries the original move facts in the payload so
 * the host can reconstruct the inverse. Only an EXECUTED, invertible mutation (clickup-move) yields
 * a rollback; everything else returns null. PURE: deterministic given (original, now).
 */

import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
import { ADAPTER_ROUTE_KEY } from "../cockpit/suggestions/suggestion-to-mutation.js";

function str(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Generate a `rollback_pending_approval` proposal that would undo `original`, or null when the
 * original is not an executed, invertible clickup-move with complete facts. The id is deterministic
 * (`rollback-<original.id>`) so re-requesting the same rollback never duplicates. The payload keeps
 * the ORIGINAL move facts (from/to as executed) — the executor derives the inverse (the reverse move).
 */
export function rollbackProposalFor(original: ProposalQueueItem, now: Date): ProposalQueueItem | null {
  if (original.status !== "executed") return null;

  const payload = original.proposedPayload ?? {};
  const route = payload[ADAPTER_ROUTE_KEY] as { adapterId?: string } | undefined;
  if (route?.adapterId !== "clickup-move-status") return null;

  const cardId = str(payload, "cardId");
  const cardName = str(payload, "cardName");
  const fromStatus = str(payload, "fromStatus");
  const toStatus = str(payload, "toStatus");
  if (!cardId || !cardName || !fromStatus || !toStatus) return null;

  const ts = now.toISOString();
  return {
    id: `rollback-${original.id}`,
    domain: original.domain,
    actionType: original.actionType,
    title: `Rollback: ${original.title}`,
    description: `Undo the executed move of card "${cardName}" (${cardId}): return it ${toStatus} → ${fromStatus}.`,
    sourceIntent: "rollback",
    proposedPayload: {
      [ADAPTER_ROUTE_KEY]: { adapterId: "clickup-move-status", tier: "T3" },
      rollbackOf: original.id,
      cardId,
      cardName,
      // The ORIGINAL move facts (as executed). The executor derives the inverse (reverse move).
      fromStatus,
      toStatus,
    },
    expectedEffect: `Move card ${cardId} back ${toStatus} → ${fromStatus} (reverses the original).`,
    riskLevel: original.riskLevel,
    requiredApproval: "Hart",
    expiresAt: null,
    safetyNotes: ["Rollback only runs if the original is confirmed landed and the card still sits at the original target."],
    blockedReason: "",
    dryRunResult: null,
    executable: false,
    tier: "T3",
    targetId: original.targetId ?? cardId,
    createdAt: ts,
    status: "rollback_pending_approval",
    updatedAt: ts,
    auditEvents: [],
  } as ProposalQueueItem;
}
