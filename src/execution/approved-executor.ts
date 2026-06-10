/**
 * src/execution/approved-executor.ts
 *
 * "Approve → it moves, no separate CLI." The host-side executor that reconstructs a
 * MutationCommand from a proposal HART ALREADY APPROVED (status === EXECUTABLE_FROM) and
 * dispatches it through the SAME gated path (`dispatchMutation`). Instead of Hart typing
 * card/from/to into a CLI, the executor reads them from the approved proposal's payload (the
 * fields the mutate rehearsal baked in + the adapter route).
 *
 * This adds NO authority and removes NO gate. The chain is still:
 *   Hart approves (cockpit, gated transition) → proposal becomes approved_for_execution →
 *   executor reconstructs the command → dispatchMutation → the adapter's fail-closed gate
 *   (ALLOW_EXEC_* flag default-OFF + kill-switch + live read-before-write + idempotency) decides.
 * The CLI's per-card args were a redundant second human step; the human gate is the APPROVAL.
 * Arming the flag stays the deliberate "I'm live" act, and the executor only ever touches
 * proposals Hart approved — never autonomous, never bulk-by-default.
 *
 * PURE core (reconstruction + orchestration over injected `dispatch`); NODE-HOST ONLY at the
 * edges (the real stores/clickup-client/pg are injected by the script). NEVER imported by the
 * read-only Worker.
 */

import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
import { ADAPTER_ROUTE_KEY } from "../cockpit/suggestions/suggestion-to-mutation.js";
import { EXECUTABLE_FROM } from "../doctrine/execution-gate.js";
import type { MutationCommand, MutationAdapterId, DispatchResult, DispatchOptions } from "./execution-dispatch.js";
import type { ClickUpMoveStore } from "./adapters/clickup-move-status.js";
import type { ClickUpCommentStore } from "./adapters/clickup-comment.js";
import type { RejectDraftsStore } from "./adapters/reject-drafts.js";
import type { ArchiveRejectedStore } from "./adapters/archive-rejected.js";

/** The live stores a host injects (ClickUp + the internal proposal-queue cleanup stores). */
export interface ApprovedExecutorStores {
  clickUpMove?: ClickUpMoveStore;
  clickUpComment?: ClickUpCommentStore;
  /** Internal-cleanup stores (pg-backed) — enable Wolverine FixProposals to fire via approval. */
  rejectDrafts?: RejectDraftsStore;
  archiveRejected?: ArchiveRejectedStore;
}

/** Injected gated dispatcher (the real `dispatchMutation` in production; a fake in tests). */
export type DispatchFn = (
  command: MutationCommand,
  env: Record<string, string | undefined>,
  opts?: DispatchOptions,
) => Promise<DispatchResult>;

export interface ExecuteApprovedInput {
  proposals: ProposalQueueItem[];
  stores: ApprovedExecutorStores;
  env: Record<string, string | undefined>;
  dispatch: DispatchFn;
  /** Injected now (never the ambient clock). */
  now: Date;
  /** Cap how many approved proposals to execute in one pass (default 1 — one card at a time). */
  max?: number;
}

export interface ExecuteOneResult {
  proposalId: string;
  adapterId: MutationAdapterId | null;
  outcome: "executed" | "no_write" | "skipped" | "error";
  /** True only when a real write actually executed (the dispatch delta was non-null). */
  wrote: boolean;
  detail: string;
}

export interface ExecuteApprovedSummary {
  considered: number;
  executable: number;
  executed: number;
  results: ExecuteOneResult[];
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Reconstruct a gated MutationCommand from an APPROVED proposal. Pure. Returns null (with no
 * side effect) when the proposal isn't executable, carries no adapter route, the payload is
 * incomplete, or the store for its adapter isn't available — the executor then skips it honestly.
 * Only the two external ClickUp adapters are wired for approve→auto-execute today.
 */
export function commandFromApprovedProposal(p: ProposalQueueItem, stores: ApprovedExecutorStores): MutationCommand | { skip: string } {
  if (p.status !== EXECUTABLE_FROM) return { skip: `status "${p.status}" is not "${EXECUTABLE_FROM}"` };
  const payload = p.proposedPayload ?? {};
  // Read the adapter route straight from the payload (ProposalQueueItem's status union differs
  // from TypedActionProposal, so we don't route it through readMutationRoute's stricter type).
  const route = payload[ADAPTER_ROUTE_KEY] as { adapterId?: MutationAdapterId } | undefined;
  if (!route?.adapterId) return { skip: "no mutationRoute on the proposal payload" };
  const proposalRef = { id: p.id, status: p.status, expiresAt: p.expiresAt };

  if (route.adapterId === "clickup-move-status") {
    if (!stores.clickUpMove) return { skip: "no ClickUp move store injected" };
    const cardId = str(payload, "cardId");
    const cardName = str(payload, "cardName");
    const fromStatus = str(payload, "fromStatus");
    const toStatus = str(payload, "toStatus");
    if (!cardId || !cardName || !fromStatus || !toStatus) return { skip: "incomplete move payload (need cardId/cardName/fromStatus/toStatus)" };
    return { adapterId: "clickup-move-status", proposal: proposalRef, target: { cardId, cardName, fromStatus, toStatus }, store: stores.clickUpMove };
  }

  if (route.adapterId === "clickup-comment") {
    if (!stores.clickUpComment) return { skip: "no ClickUp comment store injected" };
    const cardId = str(payload, "cardId");
    const cardName = str(payload, "cardName");
    const commentText = str(payload, "commentText");
    if (!cardId || !cardName || !commentText) return { skip: "incomplete comment payload (need cardId/cardName/commentText)" };
    return { adapterId: "clickup-comment", proposal: proposalRef, target: { cardId, cardName, commentText }, store: stores.clickUpComment };
  }

  // Internal proposal-queue cleanups (bulk-by-status; no per-row target). These are the first
  // adapters a Wolverine FixProposal routes to — same gate (ALLOW_EXEC_* + approval) decides.
  if (route.adapterId === "reject-drafts") {
    if (!stores.rejectDrafts) return { skip: "no reject-drafts store injected" };
    return { adapterId: "reject-drafts", proposal: proposalRef, store: stores.rejectDrafts };
  }
  if (route.adapterId === "archive-rejected") {
    if (!stores.archiveRejected) return { skip: "no archive-rejected store injected" };
    return { adapterId: "archive-rejected", proposal: proposalRef, store: stores.archiveRejected };
  }

  return { skip: `adapter "${route.adapterId}" is not wired for approve→auto-execute yet` };
}

/**
 * Execute the approved proposals (newest-first), capped at `max` (default 1 — one card per pass).
 * Each command is dispatched through the injected gated `dispatch`; the per-adapter ALLOW_EXEC_*
 * flag + kill-switch + live read-before-write still decide. Never throws on a single failure —
 * it records the error and continues. Returns an honest per-proposal summary.
 */
export async function executeApprovedProposals(input: ExecuteApprovedInput): Promise<ExecuteApprovedSummary> {
  const max = input.max ?? 1;
  const executableList = input.proposals
    .filter((p) => p.status === EXECUTABLE_FROM)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const results: ExecuteOneResult[] = [];
  let executed = 0;

  for (const p of executableList) {
    if (executed >= max) break;
    const built = commandFromApprovedProposal(p, input.stores);
    if ("skip" in built) {
      results.push({ proposalId: p.id, adapterId: null, outcome: "skipped", wrote: false, detail: built.skip });
      continue;
    }
    try {
      const res = await input.dispatch(built, input.env, { now: input.now });
      const wrote = res.delta !== null;
      results.push({
        proposalId: p.id,
        adapterId: built.adapterId,
        outcome: wrote ? "executed" : "no_write",
        wrote,
        detail: res.result.outcome?.summary ?? (wrote ? "executed" : "no write (gate refused / noop / not armed)"),
      });
      if (wrote) executed += 1;
    } catch (err) {
      results.push({ proposalId: p.id, adapterId: built.adapterId, outcome: "error", wrote: false, detail: (err as Error).message });
    }
  }

  return { considered: input.proposals.length, executable: executableList.length, executed, results };
}

/** Re-export for the host script's convenience (the payload key proposals carry the route under). */
export { ADAPTER_ROUTE_KEY };
