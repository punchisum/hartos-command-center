/**
 * src/fitness/fitness-mutation-materialize.ts — P5: a polled pending mutation → a spine proposal.
 *
 * The fitness Trigger.dev side (same DB — Hart Personal Core) writes a deterministic pending
 * mutation when the recovery verdict calls for one. The command-center poller (live-runner) reads
 * them via get_pending_mutations and materialises each into a ProposalQueueItem that rides the
 * gated spine → executor → the fitness-mutation adapter. This PURE layer pins the cross-repo
 * contract from the command-center side. No I/O, no clock (now injected), no LLM.
 */

import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
import { ADAPTER_ROUTE_KEY } from "../cockpit/suggestions/suggestion-to-mutation.js";

/** The cross-repo contract: what the fitness side writes / get_pending_mutations returns per row. */
export interface PendingFitnessMutation {
  stateDate: string;
  recoveryBand: "green" | "amber" | "red";
  recoveryScore: number | null;
  /** The deterministic adjustment (from deriveFitnessAdjustment — never an LLM). */
  action: "as-planned" | "controlled" | "defer";
  caloriePct: number;
  reason: string;
  /** Idempotency key from the fitness side (state_date + band + mutation type). */
  idempotencyKey: string;
}

/** Cap free-text so the payload never carries unbounded text (defence-in-depth; reason is not LLM). */
function cap(text: string, max = 300): string {
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * Materialise a pending fitness mutation into a Tier-1 fitness ProposalQueueItem routed to the
 * fitness-mutation adapter. The id is deterministic (one proposal per state_date+band) so re-polling
 * never duplicates. The payload carries exactly what commandFromApprovedProposal reconstructs the
 * fitness-mutation command from. Enters as pending_approval — the approval floor (Hart, or the armed
 * autoheal class) still decides; nothing executes here.
 */
export function pendingFitnessMutationToProposal(pending: PendingFitnessMutation, now: Date): ProposalQueueItem {
  const ts = now.toISOString();
  const reason = cap(pending.reason);
  const verb = pending.action === "defer" ? "Defer the session" : pending.action === "controlled" ? "Keep effort controlled" : "Proceed as planned";
  return {
    id: `fitness-${pending.stateDate}-${pending.recoveryBand}`,
    domain: "fitness",
    actionType: "fitness_adjustment_plan",
    title: `Fitness: ${verb} (${pending.recoveryBand} recovery, ${pending.stateDate})`,
    description: `${reason}${pending.caloriePct !== 0 ? ` Calorie target ${pending.caloriePct > 0 ? "+" : ""}${pending.caloriePct}%.` : ""}`,
    sourceIntent: "fitness-autonomous",
    proposedPayload: {
      [ADAPTER_ROUTE_KEY]: { adapterId: "fitness-mutation", tier: "T1" },
      stateDate: pending.stateDate,
      recoveryBand: pending.recoveryBand,
      recoveryScore: pending.recoveryScore,
      action: pending.action,
      caloriePct: pending.caloriePct,
      reason,
      idempotencyKey: pending.idempotencyKey,
    },
    expectedEffect: pending.caloriePct !== 0
      ? `Adjust the ${pending.stateDate} calorie target by ${pending.caloriePct}% and set the plan to "${pending.action}".`
      : `Set the ${pending.stateDate} plan to "${pending.action}" (no calorie change).`,
    riskLevel: "low",
    requiredApproval: "Hart",
    expiresAt: null,
    safetyNotes: ["Inside the fence — Hart's own training only. Reversible + idempotent; the adapter refuses if there is no state for the date."],
    blockedReason: "",
    dryRunResult: null,
    executable: false,
    tier: "T1",
    targetId: pending.stateDate,
    createdAt: ts,
    status: "pending_approval",
    updatedAt: ts,
    auditEvents: [],
  } as ProposalQueueItem;
}
