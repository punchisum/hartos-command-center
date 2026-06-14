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
import type { CouncilProposalPayload, Confidence } from "./council-types.js";
import { calibrateConfidence, COUNCIL_BAND_APPROVAL } from "./council-calibration.js";

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
  // P8: the calibration priors to present against. Defaults to the live module constant
  // (which P8 recalibrates via the §6 gauntlet); injectable for tests.
  priors: Record<Confidence, number> = COUNCIL_BAND_APPROVAL,
): Promise<string> {
  const ts = now.toISOString();
  const id = makeCouncilProposalId(now);

  // P8: demote-only calibrated band for the cockpit. Raw `confidence` is preserved untouched
  // (audit + the band the aggregator measures approval against). At neutral priors the
  // calibrated band equals the raw band and nothing changes; once P8 demotes a band, Hart
  // sees it in the title + a safety note.
  const calibratedConfidence = calibrateConfidence(payload.confidence, priors);
  const demoted = calibratedConfidence !== payload.confidence;

  // Title: "Council: <recommendation (first 120 chars)> [<band>]", where <band> is the raw
  // band, or "raw→calibrated" when P8 has demoted it (so the calibration is visible at a glance).
  const recSnippet = payload.recommendation.slice(0, 120);
  const bandLabel = demoted ? `${payload.confidence}→${calibratedConfidence}` : payload.confidence;
  const title = `Council: ${recSnippet} [${bandLabel}]`;

  const item: ProposalQueueItem = {
    id,
    domain: "council",
    actionType: "council_plan",
    title,
    description:
      `Council orchestration completed for goal: "${payload.rootGoal}". ` +
      `Overall confidence: ${payload.confidence}. ` +
      (demoted
        ? `Calibrated for presentation to ${calibratedConfidence} (P8: this band is historically over-trusted; raw band preserved). `
        : "") +
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
      ...(demoted
        ? [
            `Calibration: council ${payload.confidence.toUpperCase()} calls are historically over-trusted — presented as ${calibratedConfidence.toUpperCase()} (P8 demote-only; the raw ${payload.confidence} band is preserved in the payload).`,
          ]
        : []),
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
