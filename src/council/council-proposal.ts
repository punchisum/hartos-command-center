/**
 * src/council/council-proposal.ts
 *
 * P7 Council — proposal adapter (Task 2.2).
 *
 * Turns a CouncilProposalPayload into a pending_approval ProposalQueueItem and
 * persists it via an injected store.  Mirrors the self-mod-proposal adapter
 * pattern: domain="council", actionType="council_plan", tier T3, executable=false.
 *
 * Propose-only: this module never executes anything.  The upserter is injected so
 * this module is unit-testable without a real DB.
 */

import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
import type { CouncilProposalPayload } from "./council-types.js";
import { calibrateConfidence } from "./council-calibration.js";

/** Minimal upserter surface (matches SelfModProposalStore pattern). */
export interface CouncilProposalStore {
  upsert(item: ProposalQueueItem): Promise<void>;
}

/** Build a deterministic proposal id from a Date (colon/dot-free, DB + filename safe). */
function makeCouncilProposalId(now: Date): string {
  return `prop-council-${now.toISOString().replace(/[:.]/g, "-")}`;
}

/**
 * Materialise a CouncilProposalPayload as a T3 pending_approval council proposal and persist it
 * via the injected store.  Returns the deterministic proposal id.
 */
export async function createCouncilProposal(
  store: CouncilProposalStore,
  payload: CouncilProposalPayload,
  now: Date,
): Promise<string> {
  const ts = now.toISOString();
  const id = makeCouncilProposalId(now);

  // Title: "Council: <recommendation (first 120 chars)> [<confidence>]"
  const recSnippet = payload.recommendation.slice(0, 120);
  const title = `Council: ${recSnippet} [${payload.confidence}]`;

  // P8: demote-only calibrated band attached for the cockpit. Raw `confidence` is preserved
  // untouched (audit + the band the aggregator measures approval against).
  const calibratedConfidence = calibrateConfidence(payload.confidence);

  const item: ProposalQueueItem = {
    id,
    domain: "council",
    actionType: "council_plan",
    title,
    description:
      `Council orchestration completed for goal: "${payload.rootGoal}". ` +
      `Overall confidence: ${payload.confidence}. ` +
      `${payload.llmCallsUsed} LLM call(s) used. ` +
      `The full council tree is attached in the payload; no execution has occurred.`,
    sourceIntent: `council-goal: ${payload.rootGoal}`,
    proposedPayload: {
      rootGoal: payload.rootGoal,
      recommendation: payload.recommendation,
      confidence: payload.confidence,
      calibratedConfidence,
      tree: payload.tree,
      llmCallsUsed: payload.llmCallsUsed,
    },
    expectedEffect:
      `Hart reviews the council's recommendation and approves or rejects the synthesized plan. ` +
      `No mutation has occurred; the council is propose-only.`,
    riskLevel: "high",
    requiredApproval: "Hart",
    status: "pending_approval",
    executable: false,
    blockedReason: "Council proposals are propose-only. Hart's approval is required before any action.",
    expiresAt: null,
    safetyNotes: [
      "This council run produced a recommendation only — nothing has been executed.",
      "The council tree in the payload carries consensus, dissent, and per-specialist confidence.",
      "No mutation adapter was called; the council is exclusively a proposal-generating orchestration.",
    ],
    dryRunResult: null,
    createdAt: ts,
    updatedAt: ts,
    auditEvents: [
      {
        at: ts,
        event: "created",
        detail: `Council proposal created for goal="${payload.rootGoal}" (confidence=${payload.confidence}, llmCalls=${payload.llmCallsUsed})`,
      },
    ],
    // Tiering: T3 (planning artifact with external-quality payload), executable=false.
    tier: "T3",
    targetId: id,
    targetName: `council:${payload.rootGoal.slice(0, 60)}`,
    beforeState: {},
    afterState: {
      recommendationPreview: payload.recommendation.slice(0, 500),
      confidence: payload.confidence,
      calibratedConfidence,
    },
    rollbackOrCorrectionNote:
      "Council proposals are recommendation-only; there is nothing to roll back.",
  };

  await store.upsert(item);
  return id;
}
