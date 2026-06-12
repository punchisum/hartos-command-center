/**
 * src/execution/execution-dispatch.ts — §12/§13: the unified, gated execute path.
 *
 * Until now each mutation adapter (refresh-sync, reject-drafts, archive-rejected, clickup-comment,
 * clickup-move-status) stood alone with its own runner. This module is the ONE entry the Node
 * execution host calls to run any of them: it dispatches a typed `MutationCommand` to the right
 * gated runner and, when (and only when) a write actually executed, projects the §13
 * `StateDeltaSignal` so the Fleet Brain can update incrementally instead of re-digesting the world.
 *
 * It changes NO safety property — every runner still enforces the Phase 2.5 fail-closed gate +
 * its own default-OFF allowlist flag under the global kill-switch. The dispatcher adds no new
 * authority; it only routes and then projects the delta the executor already had the data for.
 *
 * NODE/EDGE EXECUTION HOST ONLY. This imports the runners (which reach pg / the ClickUp token /
 * the capability-token Edge Function) and MUST NEVER be imported into the read-only cockpit
 * Worker bundle. A noop, a refusal, or a dry-run emits a `null` delta (nothing executed).
 */

import type { AdapterRunResult } from "./execution-adapter.js";
import { toStateDeltaSignal, type StateDeltaSignal } from "./state-delta.js";
import type { ProposalDomain, ProposalActionType } from "../cockpit/proposals/proposal-types.js";
import { verifyExecutionOutcome, type VerificationResult, type VerificationInput } from "./execution-verification.js";
import { verificationInputForCommand } from "./verification-input.js";

import { runRefreshSync, type RefreshSyncProposal } from "./run-refresh-sync.js";
import type { RefreshSyncStore } from "./adapters/refresh-sync.js";
import { runRejectDrafts, type RejectDraftsProposal } from "./run-reject-drafts.js";
import type { RejectDraftsStore } from "./adapters/reject-drafts.js";
import { runArchiveRejected, type ArchiveRejectedProposal } from "./run-archive-rejected.js";
import type { ArchiveRejectedStore } from "./adapters/archive-rejected.js";
import { runMarkReviewed, type MarkReviewedProposal } from "./run-mark-reviewed.js";
import type { MarkReviewedStore } from "./adapters/mark-reviewed.js";
import { runClickUpComment, type ClickUpCommentProposal, type ClickUpCommentTarget } from "./run-clickup-comment.js";
import type { ClickUpCommentStore } from "./adapters/clickup-comment.js";
import { runClickUpMove, type ClickUpMoveProposal, type ClickUpMoveTarget } from "./run-clickup-move.js";
import type { ClickUpMoveStore } from "./adapters/clickup-move-status.js";
import { runFitnessMutation, type FitnessMutationProposal, type FitnessMutationTarget } from "./run-fitness-mutation.js";
import type { FitnessMutationStore } from "./adapters/fitness-mutation.js";

/** The adapter ids this dispatcher knows. */
export type MutationAdapterId =
  | "refresh-sync"
  | "reject-drafts"
  | "archive-rejected"
  | "mark-reviewed"
  | "clickup-comment"
  | "clickup-move-status"
  | "fitness-mutation";

/** The §13 fan-out facts a delta needs. Defaulted per adapter; a command may override. */
export interface DeltaContext {
  domain: ProposalDomain;
  actionType: ProposalActionType;
  changedEntity: string;
}

/**
 * A typed, discriminated mutation command — each variant carries exactly what its runner needs.
 * `store` is injected (the live token/pg-bearing store in production, a fake in tests). The
 * optional `delta` overrides the per-adapter default fan-out facts.
 */
export type MutationCommand =
  | { adapterId: "refresh-sync"; proposal: RefreshSyncProposal; store?: RefreshSyncStore; delta?: Partial<DeltaContext> }
  | { adapterId: "reject-drafts"; proposal: RejectDraftsProposal; store: RejectDraftsStore; delta?: Partial<DeltaContext> }
  | { adapterId: "archive-rejected"; proposal: ArchiveRejectedProposal; store: ArchiveRejectedStore; delta?: Partial<DeltaContext> }
  | { adapterId: "mark-reviewed"; proposal: MarkReviewedProposal; store: MarkReviewedStore; delta?: Partial<DeltaContext> }
  | { adapterId: "clickup-comment"; proposal: ClickUpCommentProposal; target: ClickUpCommentTarget; store: ClickUpCommentStore; delta?: Partial<DeltaContext> }
  | { adapterId: "clickup-move-status"; proposal: ClickUpMoveProposal; target: ClickUpMoveTarget; store: ClickUpMoveStore; delta?: Partial<DeltaContext> }
  | { adapterId: "fitness-mutation"; proposal: FitnessMutationProposal; target: FitnessMutationTarget; store: FitnessMutationStore; delta?: Partial<DeltaContext> };

export interface DispatchOptions {
  /** Injected for determinism (never the ambient clock). Threaded to both runner + delta. */
  now?: Date;
  /** Preview only — every runner counts/reads but never writes; the delta is always null. */
  dryRun?: boolean;
  /** Explicit write-authorization override; otherwise each runner derives it from env. */
  hasCapabilityToken?: boolean;
}

export interface DispatchResult {
  adapterId: MutationAdapterId;
  result: AdapterRunResult;
  /** The §13 delta — non-null ONLY when a write actually executed (never for noop/refusal/dry-run). */
  delta: StateDeltaSignal | null;
  /**
   * P3 post-execution verification: did an INDEPENDENT fresh re-read confirm the change LANDED?
   * Non-null only when a write executed AND the adapter has a re-verify path; fails CLOSED
   * (`landed:false`) when the re-read could not be made. Null when nothing wrote or the adapter
   * has no external re-verify path wired yet.
   */
  verification: VerificationResult | null;
}

/**
 * Per-adapter default fan-out facts. ClickUp card mutations surface as ops; the internal queue
 * adapters surface as system sync repair. `actionType` is constrained to the existing
 * `ProposalActionType` enum (StateDeltaSignal requires one); a command may override via `delta`.
 */
const DEFAULT_DELTA: Record<MutationAdapterId, { domain: ProposalDomain; actionType: ProposalActionType }> = {
  "refresh-sync": { domain: "system", actionType: "sync_repair_plan" },
  "reject-drafts": { domain: "system", actionType: "sync_repair_plan" },
  "archive-rejected": { domain: "system", actionType: "sync_repair_plan" },
  "mark-reviewed": { domain: "ops", actionType: "review_plan" },
  "clickup-comment": { domain: "ops", actionType: "ops_followup_plan" },
  "clickup-move-status": { domain: "ops", actionType: "ops_followup_plan" },
  "fitness-mutation": { domain: "fitness", actionType: "fitness_adjustment_plan" },
};

/** Resolve the changedEntity for a command (ClickUp uses the card name; internal uses the proposal id). */
function defaultChangedEntity(command: MutationCommand): string {
  switch (command.adapterId) {
    case "clickup-comment":
    case "clickup-move-status":
      return command.target.cardName;
    case "fitness-mutation":
      return `fitness ${command.target.stateDate}`;
    default:
      return `proposal ${command.proposal.id}`;
  }
}

/**
 * P3: an INDEPENDENT fresh re-read of the external state AFTER a write, for adapters that have a
 * re-verify path. Returns `{ strategy: true, observed }` (observed is null when the re-read could
 * not be made — fail closed), or `{ strategy: false }` for adapters with no external re-verify
 * path wired yet. Reads ONLY through the same injected store the runner used (never new I/O auth).
 * Never throws: a thrown re-read is treated as an unmade observation (observed null).
 */
async function freshObservedForCommand(
  command: MutationCommand,
): Promise<{ strategy: true; observed: VerificationInput["observed"] } | { strategy: false }> {
  switch (command.adapterId) {
    case "clickup-move-status": {
      try {
        const card = await command.store.getCard(command.target.cardId);
        return { strategy: true, observed: card ? { status: card.status } : null };
      } catch {
        // A failed re-read ⇒ unproven ⇒ fail closed (observed null → not landed).
        return { strategy: true, observed: null };
      }
    }
    default:
      // comment / refresh-sync / internal-queue adapters: their fresh-re-read paths are added as
      // each is wired (mirrors verificationInputForCommand, which returns null for them today).
      return { strategy: false };
  }
}

/**
 * P3: after a write actually executed, do the fresh re-read + judge whether the change LANDED.
 * Returns null when the adapter has no re-verify path (honest — never a false "landed").
 */
async function verifyCommandLanded(command: MutationCommand): Promise<VerificationResult | null> {
  const fresh = await freshObservedForCommand(command);
  if (!fresh.strategy) return null;
  const input = verificationInputForCommand(command, fresh.observed);
  return input ? verifyExecutionOutcome(input) : null;
}

/** Run the chosen runner. Each enforces its own fail-closed gate + default-OFF allowlist flag. */
async function runCommand(
  command: MutationCommand,
  env: Record<string, string | undefined>,
  opts: DispatchOptions,
): Promise<AdapterRunResult> {
  const now = opts.now ? opts.now.toISOString() : undefined;
  const shared = { now, dryRun: opts.dryRun, hasCapabilityToken: opts.hasCapabilityToken };
  switch (command.adapterId) {
    case "refresh-sync":
      return runRefreshSync(command.proposal, env, { ...shared, store: command.store });
    case "reject-drafts":
      return runRejectDrafts(command.proposal, env, { ...shared, store: command.store });
    case "archive-rejected":
      return runArchiveRejected(command.proposal, env, { ...shared, store: command.store });
    case "mark-reviewed":
      return runMarkReviewed(command.proposal, env, { ...shared, store: command.store });
    case "clickup-comment":
      return runClickUpComment(command.proposal, command.target, env, { ...shared, store: command.store });
    case "clickup-move-status":
      return runClickUpMove(command.proposal, command.target, env, { ...shared, store: command.store });
    case "fitness-mutation":
      return runFitnessMutation(command.proposal, command.target, env, { ...shared, store: command.store });
  }
}

/**
 * The ONE gated execute path. Dispatches `command` to its runner (which enforces the gate) and,
 * when a write actually executed, projects the §13 StateDeltaSignal from the same
 * `AdapterRunResult` the executor already holds. Returns `{ result, delta }`; `delta` is null for
 * any noop, refusal, or dry-run. The dispatcher adds NO authority — it only routes and projects.
 */
export async function dispatchMutation(
  command: MutationCommand,
  env: Record<string, string | undefined>,
  opts: DispatchOptions = {},
): Promise<DispatchResult> {
  const result = await runCommand(command, env, opts);

  const base = DEFAULT_DELTA[command.adapterId];
  const delta = toStateDeltaSignal(result, {
    source: command.adapterId,
    domain: command.delta?.domain ?? base.domain,
    actionType: command.delta?.actionType ?? base.actionType,
    proposalId: command.proposal.id,
    changedEntity: command.delta?.changedEntity ?? defaultChangedEntity(command),
    now: opts.now,
  });

  // P3: a write actually executed (delta non-null) ⇒ independently re-read + verify it landed.
  // No write (delta null) ⇒ nothing to verify. Fails closed inside verifyCommandLanded.
  const verification = delta !== null ? await verifyCommandLanded(command) : null;

  return { adapterId: command.adapterId, result, delta, verification };
}
