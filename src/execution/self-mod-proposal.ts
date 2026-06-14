/**
 * src/execution/self-mod-proposal.ts
 *
 * P6 §6 — Tier-2 self-mod proposal (propose-only; carries the verified change for Hart's approval).
 *
 * When runSelfModPass routes a verified change to propose(), this adapter materialises a
 * ProposalQueueItem with status=pending_approval and executable=false into the cockpit proposal
 * spine. The upserter is injected so this module is unit-testable without a real DB.
 */

import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
import type { SelfModTask } from "./self-mod-pass.js";
import type { TierVerdict } from "./self-mod-classifier.js";

/** Diff cap: keeps the proposal payload bounded; a full-sized diff can exceed JSONB comfort. */
const DIFF_CAP = 8000;

/**
 * Minimal upserter surface. The Node host injects a real pg-backed implementation; tests inject a
 * fake. Nothing executes here — this is strictly a write-to-spine operation.
 */
export interface SelfModProposalStore {
  upsert(item: ProposalQueueItem): Promise<void>;
}

/**
 * Build a deterministic proposal id from a Date. Colons and dots are replaced so the id is safe as
 * a DB key and a file name. Two calls with the same `now` always return the same id.
 */
function makeSelfModProposalId(now: Date): string {
  return `prop-self-mod-${now.toISOString().replace(/[:.]/g, "-")}`;
}

/**
 * Materialise a Tier-2 self-mod change as a propose-only cockpit proposal and write it to the
 * spine via the injected store. Returns the deterministic proposal id.
 */
export async function createSelfModProposal(
  store: SelfModProposalStore,
  task: SelfModTask,
  tier: TierVerdict,
  diff: string,
  now: Date,
): Promise<string> {
  const ts = now.toISOString();
  const id = makeSelfModProposalId(now);
  const truncatedDiff = diff.slice(0, DIFF_CAP);

  const item: ProposalQueueItem = {
    id,
    domain: "self-mod",
    actionType: "self_mod_plan",
    title: `Self-mod: ${task.selfModClass} — ${task.description.slice(0, 120)}`,
    description:
      `Tier-2 self-modification (${task.selfModClass}) queued for Hart's approval. ` +
      `Tier verdict: ${tier.reason}. ` +
      `The verified diff is attached in the payload; no change has been applied to the running system.`,
    sourceIntent: `self-mod-class:${task.selfModClass}`,
    proposedPayload: {
      class: task.selfModClass,
      tier: tier.tier,
      reason: tier.reason,
      diff: truncatedDiff,
    },
    expectedEffect:
      `Apply the verified ${task.selfModClass} self-modification after Hart approves. ` +
      `The change has been rolled back from the working tree and must be re-applied by the executor.`,
    riskLevel: "high",
    requiredApproval: "Hart",
    status: "pending_approval",
    executable: false,
    blockedReason: "Tier-2 self-mod: propose-only. Hart's approval is required before any application.",
    expiresAt: null,
    safetyNotes: [
      "The diff has been verified by the self-mod gauntlet but NOT applied to the running system.",
      "The working tree was rolled back after capture; no partial state remains.",
      "Re-application is executor-gated and requires Hart's explicit approval.",
    ],
    dryRunResult: null,
    createdAt: ts,
    updatedAt: ts,
    auditEvents: [
      { at: ts, event: "created", detail: `Tier-2 proposal created for self-mod class="${task.selfModClass}"` },
    ],
    // Tiering fields (master plan §10) — self-mod proposals are T3: external-mutation-class risk level,
    // full before/after payload required before execution (which is always separately gated).
    tier: "T3",
    targetId: id,
    targetName: `self-mod:${task.selfModClass}`,
    beforeState: {},
    afterState: { diffPreview: truncatedDiff.slice(0, 500) },
    rollbackOrCorrectionNote:
      "The working tree was already rolled back at capture time. To undo after execution, revert the committed change manually.",
  };

  await store.upsert(item);
  return id;
}
