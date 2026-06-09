/**
 * src/cockpit/mutation/instruction-to-mutation.ts
 *
 * Command → dry-run mutation REHEARSAL. Turns a free-text instruction ("clear my rejected
 * proposal backlog", "comment 'paid' on card abc123") into a typed, gated mutation PROPOSAL —
 * a true rehearsal of the existing executor's contract. It NEVER writes anything: the proposal
 * is `executable:false`, status `draft`, and the real execute path (`runExecutionAdapter`) is
 * untouched and still flag-gated default-OFF.
 *
 * Floor preserved (propose-don't-act):
 *   - Pure + deterministic: keyword parse, no LLM, no clock, no network, no store.
 *   - Internal cohort actions (reject-drafts / archive-rejected) are fully resolvable from the
 *     instruction alone → a COMPLETE, tier-valid T0 proposal the executor would run IF armed.
 *   - ClickUp comment/move need a specific card; the read-only snapshot carries no card records,
 *     so we HONESTLY return `needs_target` rather than guessing a cardId. No fabricated target.
 *   - Idempotency keys use TRUSTED parts only (adapter id, target id, date) — never the
 *     instruction text or any free-text payload (which would be rejected by makeIdempotencyKey).
 */

import type { DryRunResult, ProposalDomain, ProposalActionType, TypedActionProposal } from "../proposals/proposal-types.js";
import { assertTierPayloadComplete, type TierPayloadResult } from "../proposals/proposal-tiering.js";
import { ADAPTER_ROUTE_KEY } from "../suggestions/suggestion-to-mutation.js";
import type { MutationAdapterId } from "../../execution/execution-dispatch.js";
import { makeIdempotencyKey } from "../../lib/idempotency-key.js";

export type MutationAction = "reject-drafts" | "archive-rejected" | "clickup-comment" | "clickup-move";

export interface ParsedInstruction {
  action: MutationAction | null;
  /** Free-text target hint as typed (e.g. "the urgent card", "abc123"). */
  targetHint: string;
  /** Payload extracted from the instruction (comment body / target status). */
  payload: { commentText?: string; toStatus?: string };
  reason: string;
}

export type RehearsalStatus = "ready" | "needs_target" | "unrecognized";

export interface MutationRehearsal {
  status: RehearsalStatus;
  parsed: ParsedInstruction;
  /** A complete, tier-valid dry-run proposal — present only when status === "ready". */
  proposal: TypedActionProposal | null;
  /** Tier-payload completeness check on the proposal (the same gate the executor consults). */
  tierCheck: TierPayloadResult | null;
  /** What's still required (for needs_target) — honest, never a guessed card. */
  required: string[];
  note: string;
}

const SAFETY_NOTES = [
  "Rehearsal only — DRY-RUN. Nothing is written; this describes what a future approved+armed step WOULD do.",
  "No provider / Supabase / ClickUp / Drive / Health / Telegram writes occur here.",
  "Requires Hart approval AND an explicit per-action allowlist flag (ALLOW_EXEC_*) before any real execution.",
];

// ── parsing (deterministic keyword rules; no LLM) ──────────────────────────────
const RE_REJECT_DRAFTS = /\b(reject|clear|discard|dismiss)\b[^.]*\bdraft\b[^.]*\bproposal/i;
const RE_ARCHIVE_REJECTED = /\b(archive|clear|clean up|purge)\b[^.]*\breject(ed)?\b[^.]*\bproposal/i;
const RE_COMMENT = /\b(comment|note|add a comment|reply)\b/i;
const RE_MOVE = /\b(move|transition|set status|change status|mark)\b/i;
const RE_CARD = /\b(card|task)\b/i;

function extractQuoted(text: string): string | undefined {
  const m = text.match(/["“']([^"”']{1,400})["”']/);
  return m ? m[1] : undefined;
}
function extractToStatus(text: string): string | undefined {
  const m = text.match(/\bto\s+([a-z][a-z \-]{1,40})\b/i);
  return m ? m[1]!.trim() : undefined;
}

/** Parse a free-text instruction into a structured mutation intent. Deterministic. */
export function parseInstruction(text: string): ParsedInstruction {
  const t = (text || "").trim();
  if (!t) return { action: null, targetHint: "", payload: {}, reason: "Empty instruction." };

  // Internal cohort cleanups first (these are fully resolvable, no card needed).
  if (RE_ARCHIVE_REJECTED.test(t)) {
    return { action: "archive-rejected", targetHint: "rejected proposals", payload: {}, reason: "Archive the rejected-proposal backlog (internal, reversible)." };
  }
  if (RE_REJECT_DRAFTS.test(t)) {
    return { action: "reject-drafts", targetHint: "draft proposals", payload: {}, reason: "Reject the draft-proposal backlog (internal, reversible)." };
  }
  // ClickUp card actions (need a specific card → resolved separately).
  if (RE_COMMENT.test(t) && RE_CARD.test(t)) {
    return { action: "clickup-comment", targetHint: t, payload: { commentText: extractQuoted(t) ?? "" }, reason: "Comment on a ClickUp card (external, T3)." };
  }
  if (RE_MOVE.test(t) && RE_CARD.test(t)) {
    return { action: "clickup-move", targetHint: t, payload: { toStatus: extractToStatus(t) }, reason: "Move a ClickUp card's status (external, T3)." };
  }
  return { action: null, targetHint: t, payload: {}, reason: "No recognized mutation verb+object (try: reject draft proposals, archive rejected proposals, comment '…' on card <id>)." };
}

// ── rehearsal builder ──────────────────────────────────────────────────────────

const COHORT: Record<"reject-drafts" | "archive-rejected", { targetId: string; domain: ProposalDomain; rollback: string; effect: string }> = {
  "reject-drafts": {
    targetId: "cohort:proposals:status=draft",
    domain: "system",
    rollback: "Reversible: restore a wrongly-rejected proposal's status to draft.",
    effect: "Draft proposals in the local queue would be moved to rejected (clearing stale drafts).",
  },
  "archive-rejected": {
    targetId: "cohort:proposals:status=rejected",
    domain: "system",
    rollback: "Reversible: un-archive a wrongly-archived proposal back to rejected.",
    effect: "Rejected proposals would be archived out of the active queue.",
  },
};

function dryRun(wouldHappen: string, touch: string[]): DryRunResult {
  return {
    wouldHappen,
    dataWouldTouch: touch,
    approvalRequired: "Hart",
    executionDisabledReason: "execution is gated off-Worker; the per-action ALLOW_EXEC_* flag is default-OFF",
    futureSetupRequired: ["Hart approves the proposal", "arm the action's ALLOW_EXEC_* flag on the Node host"],
    executed: false,
  };
}

/**
 * Build a dry-run mutation rehearsal from an instruction. Pure. `now` is injected (used as a
 * TRUSTED, date-scoped idempotency part — never the instruction text). For internal cohort
 * actions the proposal is complete + tier-valid; for ClickUp actions it returns needs_target.
 */
export function planMutationFromInstruction(instruction: string, opts: { now: string; proposalId?: string }): MutationRehearsal {
  const parsed = parseInstruction(instruction);
  const now = opts.now;
  const proposalId = opts.proposalId ?? `rehearsal-${now}`;

  if (parsed.action === null) {
    return { status: "unrecognized", parsed, proposal: null, tierCheck: null, required: [], note: parsed.reason };
  }

  // ── Internal cohort cleanups → complete T0 proposal (no card lookup needed) ──
  if (parsed.action === "reject-drafts" || parsed.action === "archive-rejected") {
    const spec = COHORT[parsed.action];
    const route: { adapterId: MutationAdapterId; tier: "T0" } = { adapterId: parsed.action, tier: "T0" };
    const proposal: TypedActionProposal = {
      id: proposalId,
      domain: spec.domain,
      actionType: "sync_repair_plan" as ProposalActionType,
      title: parsed.action === "reject-drafts" ? "Reject the draft-proposal backlog" : "Archive the rejected-proposal backlog",
      description: `${parsed.reason} Rehearsal of the ${parsed.action} adapter (T0 internal cleanup).`,
      sourceIntent: `mutate: ${instruction.trim().slice(0, 120)}`,
      proposedPayload: { [ADAPTER_ROUTE_KEY]: route },
      expectedEffect: spec.effect,
      riskLevel: "low",
      requiredApproval: "Hart",
      status: "draft",
      createdAt: now,
      expiresAt: null,
      safetyNotes: SAFETY_NOTES,
      blockedReason: "execution disabled — rehearsal only",
      dryRunResult: dryRun(spec.effect, [spec.targetId]),
      executable: false,
      tier: "T0",
      targetId: spec.targetId,
      targetName: parsed.targetHint,
      idempotencyKey: makeIdempotencyKey([parsed.action, spec.targetId, now.slice(0, 10)]),
      rollbackOrCorrectionNote: spec.rollback,
    };
    const tierCheck = assertTierPayloadComplete(proposal);
    return {
      status: tierCheck.allowed ? "ready" : "needs_target",
      parsed,
      proposal,
      tierCheck,
      required: tierCheck.allowed ? [] : tierCheck.denials,
      note: tierCheck.allowed
        ? "Ready: a complete, tier-valid T0 rehearsal. Approve it, then arm the action's flag to execute for real."
        : `Incomplete proposal: ${tierCheck.denials.join(", ")}.`,
    };
  }

  // ── ClickUp comment / move → honest needs_target (no card data in the read-only snapshot) ──
  const required =
    parsed.action === "clickup-comment"
      ? ["cardId", "cardName", parsed.payload.commentText ? "" : "commentText (quote the comment)"].filter(Boolean)
      : ["cardId", "cardName", "fromStatus (current)", parsed.payload.toStatus ? "" : "toStatus (e.g. 'to in review')"].filter(Boolean);
  return {
    status: "needs_target",
    parsed,
    proposal: null,
    tierCheck: null,
    required,
    note:
      `Parsed a ${parsed.action} (T3 external) instruction, but the read-only cockpit snapshot ` +
      `carries no individual ClickUp cards — so HartOS will NOT guess a card. Supply the resolved ` +
      `target (${required.join(", ")}) and the T3 rehearsal can be completed. Still dry-run; arming a ` +
      `real write is a separate, explicitly-gated step.`,
  };
}
