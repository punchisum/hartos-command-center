/**
 * src/cockpit/mutation/mutation-center.ts
 *
 * Mutation Center — the PURE, read-only model assembler (3-levels-up master plan §12).
 *
 * This renders the PENDING-EXECUTABLE proposals as cockpit rows: each carries its tier,
 * dry-run preview, risk, confirmed target (id+name), rollback/correction note, the refused
 * actions (reasons) from the pure tier-payload check, and whether the payload is complete.
 *
 * It is a READ/CONTROL-PLANE projection only. There is NO "Execute Once" wiring here — the
 * actual execution surface is a LIVE plane and lives elsewhere (gates/queue writers/Worker
 * transition relay). Per the master plan's hard floor, this module:
 *   - imports nothing that deploys, mutates, persists, fetches, or executes,
 *   - never reads the filesystem, network, Supabase/pg, or the ambient clock,
 *   - emits `executable: "disabled"` on the model (mirroring `ProposalsView`), never a button.
 *
 * It mirrors the read-only `ProposalsView` shape in `src/runtime/cloudflare-cockpit-views.ts`
 * (origin/mode/executable), enriched with the per-row mutation payload §12 calls for.
 */

import type { ProposalQueueItem, ProposalQueueStatus } from "../proposals/proposal-types.js";
import { EXECUTOR_ONLY_STATUSES } from "../proposals/proposal-types.js";
import { assertTierPayloadComplete } from "../proposals/proposal-tiering.js";

/**
 * The cockpit-settable statuses that count as "pending executable" for the Mutation Center
 * (master plan §12 — "pending executable actions"). These are the two states a proposal can
 * sit in while it is approved-but-not-yet-mutated and the cockpit may surface it:
 *   - `simulated_approved`      — Hart approved a SIMULATION (dry-run); awaiting Key 1.
 *   - `approved_for_execution`  — Key 1 granted (the cockpit-settable execution authorization).
 *
 * EXECUTOR-ONLY states (executing/executed/execution_failed/runtime_provisioned), plus
 * draft/pending_approval/rejected/expired, are NOT pending-executable and are excluded.
 */
export const PENDING_EXECUTABLE_STATUSES: readonly ProposalQueueStatus[] = [
  "simulated_approved",
  "approved_for_execution",
];

/** A confirmed mutation target. No "apply to all" — one row, one target (master plan §12). */
export interface MutationTarget {
  /** The confirmed target's stable id (proposal's targetId, else its own id). */
  id: string;
  /** Human-readable target name, surfaced in the Mutation Center. Null when unnamed. */
  name: string | null;
}

/**
 * One Mutation Center row — a read-only projection of a pending-executable proposal.
 * `executable` is the literal `"disabled"` (NOT a boolean): this row never executes.
 */
export interface MutationCenterRow {
  id: string;
  title: string;
  domain: ProposalQueueItem["domain"];
  /** The proposal's risk/payload tier, or null when the proposal is untiered. */
  tier: ProposalQueueItem["tier"] | null;
  riskLevel: ProposalQueueItem["riskLevel"];
  /** The cockpit-settable status this row is pending in. */
  status: ProposalQueueStatus;
  /** The confirmed mutation target (id + name). */
  target: MutationTarget;
  /** Plain-English dry-run preview ("what WOULD happen"), or null when not simulated. */
  dryRun: string | null;
  /** How a (future) mutation would be undone or corrected, or null when none declared. */
  rollbackNote: string | null;
  /**
   * Refused actions (reasons) from the PURE tier-payload precondition — every missing
   * required field, named. Empty iff the payload is complete for the declared tier.
   */
  refusedActions: string[];
  /** True iff the tier-payload precondition passed (no refusals). */
  payloadComplete: boolean;
  /** Always the literal "disabled" — this surface is read-only. Never a boolean true. */
  executable: "disabled";
}

/** The assembled, read-only Mutation Center model. Mirrors `ProposalsView`'s read-only flags. */
export interface MutationCenterModel {
  /** Mirrors `ProposalsView`: the queue is local-only. */
  origin: "local";
  /** Mirrors `ProposalsView`: a read-only projection of the local queue. */
  mode: "read_only_snapshot";
  /** Always the literal "disabled" — the whole surface is read-only. */
  executable: "disabled";
  note: string;
  /** Total number of input proposals considered (before pending-executable filtering). */
  total: number;
  /** Number of pending-executable rows in this model. */
  pending: number;
  rows: MutationCenterRow[];
}

/** True iff a proposal's status is pending-executable (and not an executor-only state). */
function isPendingExecutable(status: ProposalQueueStatus): boolean {
  if (EXECUTOR_ONLY_STATUSES.includes(status)) return false;
  return PENDING_EXECUTABLE_STATUSES.includes(status);
}

/** Project one pending-executable proposal onto a read-only Mutation Center row. */
function toRow(item: ProposalQueueItem): MutationCenterRow {
  // PURE shape precondition: does this proposal carry its declared tier's required payload?
  // An untiered proposal is denied with a "no tier" refusal (fail-closed) — exactly what the
  // Mutation Center should surface so Hart sees WHY a row is not yet payload-complete. The
  // queue item's `status` is the wider `ProposalQueueStatus`; the tier check only reads the
  // tiering payload (never `status`), so we hand it the item with `status` projected away.
  const { status: _status, ...tierView } = item;
  const { allowed, denials } = assertTierPayloadComplete(tierView);
  const targetName = item.targetName ?? null;
  return {
    id: item.id,
    title: item.title,
    domain: item.domain,
    tier: item.tier ?? null,
    riskLevel: item.riskLevel,
    status: item.status,
    target: {
      id: item.targetId ?? item.id,
      name: targetName && targetName.trim().length > 0 ? targetName : null,
    },
    dryRun: item.dryRunResult ? item.dryRunResult.wouldHappen : null,
    rollbackNote: item.rollbackOrCorrectionNote ?? null,
    refusedActions: denials,
    payloadComplete: allowed,
    executable: "disabled",
  };
}

/**
 * PURE. Assemble the read-only Mutation Center model from a set of proposal queue items.
 *
 * Includes ONLY pending-executable proposals (simulated_approved / approved_for_execution);
 * excludes executor-only states (executing/executed/execution_failed/runtime_provisioned),
 * drafts, pending_approval, rejected, and expired. No HTML, no fetch, no execution import,
 * no I/O — it derives a model from the items it is handed and nothing else.
 */
export function buildMutationCenterModel(items: ProposalQueueItem[]): MutationCenterModel {
  const pending = items.filter((item) => isPendingExecutable(item.status));
  const rows = pending.map(toRow);
  return {
    origin: "local",
    mode: "read_only_snapshot",
    executable: "disabled",
    note:
      "Read-only Mutation Center projection of the local proposal queue. Each row is a pending " +
      "typed action with a confirmed target; nothing is mutated here. Approval and the actual " +
      "one-action mutation happen on the separate, gated live surface — never from this model.",
    total: items.length,
    pending: rows.length,
    rows,
  };
}
