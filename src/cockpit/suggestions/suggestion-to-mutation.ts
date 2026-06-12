/**
 * src/cockpit/suggestions/suggestion-to-mutation.ts
 *
 * Close command→propose→(approve)→mutate. `suggest-actions.ts` produces advisory
 * `SuggestedAction`s; the mutation spine fires a `TypedActionProposal` through the
 * dispatcher (`execution-dispatch.ts`). Between them was a gap: nothing turned "the
 * system suggests X" into "here is the typed, tier-complete proposal a human could
 * approve + fire." This module is that PURE mapping.
 *
 * It is honest by default: MOST suggestions stay advisory and map to `null`. Only the
 * narrowly, safely runnable ones — the internal proposal-queue cleanups (reject the
 * `draft` rows / archive the `rejected` rows) and, when the caller supplies a CONFIRMED
 * ClickUp card target, a ClickUp comment — become a tier-complete proposal that names the
 * dispatcher `adapterId` it routes to.
 *
 * Doctrine is preserved end to end:
 *   - The output is a NON-EXECUTABLE proposal (`executable:false`, `requiredApproval:"Hart"`,
 *     a `blockedReason`). Nothing runs here; the dispatcher + the single execution gate stay
 *     the sole place execution is decided.
 *   - Every produced proposal PASSES `assertTierPayloadComplete` for its declared tier.
 *   - The idempotency key is built with `makeIdempotencyKey` from TRUSTED fields only
 *     (ids / enum codes / a caller-supplied date) — NEVER the suggestion's free-text title
 *     or rationale (idempotency-key.ts rule 2).
 *
 * PURE + Worker-safe: no fs / network / clock / env, and no Node-only import. `now` and any
 * ids are INJECTED; the ambient clock is never read. This may be surfaced in the read-only
 * cockpit, so it imports only types + the pure `makeIdempotencyKey` helper.
 */

import type { SuggestedAction } from "./suggest-actions.js";
import type {
  TypedActionProposal,
  DryRunResult,
  ProposalTier,
} from "../proposals/proposal-types.js";
import type { MutationAdapterId } from "../../execution/execution-dispatch.js";
import { makeIdempotencyKey } from "../../lib/idempotency-key.js";

/**
 * Where the dispatcher `adapterId` rides on the produced proposal.
 *
 * `ActionProposal` has NO native adapter field — the closest, documented home is its
 * descriptive `proposedPayload` jsonb bag ("descriptive only, never sent anywhere"). We
 * put the routing metadata there under a single typed key so a downstream caller (the
 * `mutate` CLI / dispatcher) reads it back type-safely WITHOUT this module growing a new
 * top-level proposal field or any execution authority. The key is descriptive routing
 * intent, not an instruction to run.
 */
export const ADAPTER_ROUTE_KEY = "mutationRoute" as const;

/** The typed routing metadata carried under `proposedPayload[ADAPTER_ROUTE_KEY]`. */
export interface MutationRoute {
  /** The dispatcher adapter this proposal routes to once approved + fired. */
  adapterId: MutationAdapterId;
  /** The declared tier (mirrors `proposal.tier`, kept here so the route reads standalone). */
  tier: ProposalTier;
}

/** Read the typed `MutationRoute` back off a produced proposal (null if absent/malformed). */
export function readMutationRoute(proposal: TypedActionProposal): MutationRoute | null {
  const raw = proposal.proposedPayload[ADAPTER_ROUTE_KEY] as Partial<MutationRoute> | undefined;
  if (!raw || typeof raw.adapterId !== "string" || typeof raw.tier !== "string") return null;
  return { adapterId: raw.adapterId as MutationAdapterId, tier: raw.tier as ProposalTier };
}

/**
 * Options for the mapper. Everything that would otherwise be ambient (the clock, the
 * confirmed external target) is INJECTED so the mapping is pure + deterministic.
 */
export interface SuggestionToMutationOpts {
  /**
   * Injected timestamp (ISO string). Used as the proposal `createdAt` AND as a TRUSTED
   * idempotency-key part (a date string, never free text). Required to stay off the clock.
   */
  now: string;
  /**
   * A CONFIRMED ClickUp card target — only present when the caller has resolved a single,
   * specific card (never "apply to all"). Its presence is what unlocks the T3 ClickUp
   * mapping; absent it, ClickUp-shaped suggestions stay advisory (null).
   */
  clickUpTarget?: {
    cardId: string;
    cardName: string;
    /** The current ClickUp status, captured read-before-write for the T3 beforeState. */
    currentStatus: string;
    /** The exact comment text to post. Free text — used as PAYLOAD, never in the key. */
    commentText: string;
  };
}

/** A trusted enum code naming the internal-cleanup kind a suggestion resolves to. */
type InternalCleanupKind = "reject-drafts" | "archive-rejected";

/**
 * Deterministic classifier: does this suggestion's TRUSTED, normalized title describe one
 * of the two safe internal queue cleanups? Keys off controlled verbs/nouns only; anything
 * ambiguous returns null (advisory). We classify off the title because the suggestion
 * carries no adapter field — but the title is used only to CHOOSE the adapter, never as an
 * idempotency-key part.
 */
function classifyInternalCleanup(suggestion: SuggestedAction): InternalCleanupKind | null {
  // Only proposal-queue hygiene suggestions are candidates: they are `system`-domain and
  // their actionType is the sync/queue-repair plan. Be conservative on the domain first.
  if (suggestion.domain !== "system") return null;
  if (suggestion.actionType !== "sync_repair_plan") return null;

  const t = suggestion.title.toLowerCase();
  // The suggestion must be about the PROPOSAL QUEUE specifically.
  const aboutQueue = /\bproposal/.test(t) || /\bqueue\b/.test(t) || /\bdraft/.test(t);
  if (!aboutQueue) return null;

  // "archive ... rejected" → archive-rejected. Check archive first (more specific).
  if (/\barchive/.test(t) && /\breject/.test(t)) return "archive-rejected";
  // "reject ... draft(s)" → reject-drafts.
  if (/\breject/.test(t) && /\bdraft/.test(t)) return "reject-drafts";
  return null;
}

/** Does this suggestion describe an external ClickUp action (so a T3 mapping applies)? */
function isClickUpAction(suggestion: SuggestedAction): boolean {
  if (suggestion.domain !== "ops") return false;
  const t = suggestion.title.toLowerCase();
  return /\bclickup\b/.test(t) || /\bcard\b/.test(t) || /\bcomment\b/.test(t);
}

/** A T0 dry-run shell — descriptive only; `executed:false` proves nothing ran. */
function makeDryRun(wouldHappen: string, touches: string[]): DryRunResult {
  return {
    wouldHappen,
    dataWouldTouch: touches,
    approvalRequired: "Hart",
    executionDisabledReason:
      "This is a proposal mapped from a cockpit suggestion; execution is gated by the single execution gate and disabled here.",
    futureSetupRequired: ["Hart approves the proposal", "the per-adapter allowlist flag is enabled"],
    executed: false,
  };
}

/** Shared non-executable doctrine fields every produced proposal carries. */
function doctrineBase(suggestion: SuggestedAction, now: string) {
  return {
    id: suggestion.id,
    domain: suggestion.domain,
    actionType: suggestion.actionType,
    title: suggestion.title,
    description: suggestion.rationale,
    sourceIntent: `suggestion:${suggestion.source}`,
    expectedEffect: suggestion.rationale,
    requiredApproval: "Hart" as const,
    status: "draft" as const,
    createdAt: now,
    expiresAt: null,
    safetyNotes: [
      "Mapped from a cockpit suggestion into a typed mutation proposal — review before approving.",
      "Non-executable: approval does not run it; the dispatcher + execution gate decide execution separately.",
    ],
    blockedReason: "Execution is disabled here; this is a typed, tier-complete proposal for Hart's approval.",
    executable: false as const,
  };
}

/**
 * PURE. Map a `SuggestedAction` into a FIREABLE typed mutation proposal, or `null` when the
 * suggestion is advisory-only (the honest default for most suggestions).
 *
 * A non-null result:
 *   - declares the correct `tier` and carries the FULL payload that tier requires, so
 *     `assertTierPayloadComplete` returns `{ allowed: true }`,
 *   - names the dispatcher `adapterId` it routes to under `proposedPayload[ADAPTER_ROUTE_KEY]`
 *     (read it back with `readMutationRoute`),
 *   - is NON-EXECUTABLE (`executable:false`, `requiredApproval:"Hart"`) — it introduces no
 *     execution path; nothing runs here.
 *
 * Mappings (conservative — when in doubt, advisory `null`):
 *   - internal proposal-queue cleanup "reject drafts"      → adapter `reject-drafts`,    tier T0
 *   - internal proposal-queue cleanup "archive rejected"   → adapter `archive-rejected`, tier T0
 *   - an ops ClickUp action WITH a confirmed card target   → adapter `clickup-comment`,  tier T3
 *   - everything else                                      → null (stays advisory)
 *
 * Deterministic: same suggestion + same opts → deep-equal proposal. No I/O.
 */
export function suggestionToMutationProposal(
  suggestion: SuggestedAction,
  opts: SuggestionToMutationOpts,
): TypedActionProposal | null {
  const now = opts.now;

  // ── Internal queue cleanups → T0 (idempotency + confirmed target + approval floor) ──
  const cleanup = classifyInternalCleanup(suggestion);
  if (cleanup) {
    const adapterId: MutationAdapterId = cleanup;
    // Trusted target: the queue-status COHORT these bulk-by-status adapters act on. There is
    // no single row id (the adapters are bulk-by-status), so the confirmed target is the
    // cohort id — an enum-shaped code, never free text. This is the unit a re-run is a no-op over.
    const targetId = cleanup === "reject-drafts" ? "cohort:proposals:status=draft" : "cohort:proposals:status=rejected";
    const targetName =
      cleanup === "reject-drafts" ? "Aging draft proposals" : "Rejected proposals to archive";
    // Idempotency from TRUSTED parts only: the adapter enum code, the cohort target id, and
    // the injected date. NEVER the title/rationale (free text). A re-run same-day = no-op.
    const idempotencyKey = makeIdempotencyKey([adapterId, targetId, now.slice(0, 10)]);

    return {
      ...doctrineBase(suggestion, now),
      riskLevel: "low",
      proposedPayload: {
        [ADAPTER_ROUTE_KEY]: { adapterId, tier: "T0" } satisfies MutationRoute,
      },
      dryRunResult: null, // T0 does not require a dry-run (REQUIRED_PAYLOAD_BY_TIER.T0).
      tier: "T0",
      targetId,
      targetName,
      idempotencyKey,
      rollbackOrCorrectionNote:
        cleanup === "reject-drafts"
          ? "Reversible: restore a wrongly-rejected proposal's status to draft."
          : "Reversible: un-archive a wrongly-archived proposal back to rejected.",
    };
  }

  // ── External ClickUp comment → T3 (before+after+idempotency+dryRun+correction note) ──
  // Only when the caller has resolved a CONFIRMED single card target. Absent it, advisory.
  if (isClickUpAction(suggestion) && opts.clickUpTarget) {
    const target = opts.clickUpTarget;
    const adapterId: MutationAdapterId = "clickup-comment";
    // Idempotency from TRUSTED parts only: the external card id + the adapter enum code + the
    // injected date. Mirrors the live adapter's construction (card id + "clickup-comment" + a
    // controlled field). The suggestion id is a slug of free text, so it is deliberately NOT a
    // key part; nor is the comment text (idempotency-key.ts rule 2). Same card + same day = no-op.
    const idempotencyKey = makeIdempotencyKey([target.cardId, adapterId, now.slice(0, 10)]);

    return {
      ...doctrineBase(suggestion, now),
      riskLevel: "medium",
      proposedPayload: {
        [ADAPTER_ROUTE_KEY]: { adapterId, tier: "T3" } satisfies MutationRoute,
        // The card identity ALSO rides proposedPayload (alongside the top-level targetId/
        // targetName the tier gate reads) because the approved-executor reconstructs the
        // command by reading cardId/cardName/commentText FROM proposedPayload — it is the
        // single reader contract, mirroring the clickup-move-status payload shape. These are
        // trusted fields (the confirmed card target); cardId is already an idempotency part.
        cardId: target.cardId,
        cardName: target.cardName,
        commentText: target.commentText, // payload only — never an idempotency part.
      },
      dryRunResult: makeDryRun(
        `Would post one comment on ClickUp card "${target.cardName}".`,
        [`clickup:card:${target.cardId}`],
      ),
      tier: "T3",
      targetId: target.cardId,
      targetName: target.cardName,
      // Read-before-write: the card's current status; after-state = unchanged (a comment does
      // not move the card) so the intended end state is explicit and auditable.
      beforeState: { status: target.currentStatus, commentCountKnown: false },
      afterState: { status: target.currentStatus, commentAdded: true },
      idempotencyKey,
      rollbackOrCorrectionNote:
        "Correctable: a ClickUp comment cannot be auto-deleted via the adapter; post a follow-up correcting comment if posted in error.",
    };
  }

  // Advisory-only — most suggestions are not safely runnable. Honest null.
  return null;
}
