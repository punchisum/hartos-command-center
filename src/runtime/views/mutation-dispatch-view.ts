/**
 * src/runtime/views/mutation-dispatch-view.ts
 *
 * Phase "3-levels-up" mutation spine — a PURE read-only cockpit view-builder that BRIDGES the
 * read-only Mutation Center (`buildMutationCenterModel`) to the SEPARATE, gated `mutate` CLI
 * (scripts/run-mutation.ts → `npm run mutate`). For each pending-executable proposal it shows:
 *
 *   - which dispatcher adapter would handle it (`adapterId`),
 *   - its tier + payload-completeness,
 *   - dispatch-readiness (`dispatchReady`),
 *   - and a COPYABLE DRY-RUN `mutate` command a human could paste to fire it SAFELY.
 *
 * This turns "the cockpit can see an approved action" into "here is the exact safe command" —
 * WITHOUT this view executing, arming, or even rendering an arm step. It mirrors
 * `mutationCenterView` exactly: the same `{ available, mode, executable:"disabled", note }`
 * honest branches, the same determinism, the same snapshot-only read of `CockpitState`.
 *
 * Read/control-plane projection ONLY. Like the model it reads:
 *   - it imports NOTHING that deploys, mutates, persists, fetches, or executes,
 *   - it never reads the filesystem, network, Supabase/pg, or the ambient clock,
 *   - `executable` stays the literal `"disabled"` on the view AND every row — never a button.
 *
 * The rendered `mutateCommand` is a DRY-RUN starting point: it NEVER contains `--execute`. Arming
 * (the `--execute` flag + the per-adapter `ALLOW_EXEC_*` env flag + the kill-switch) is the human's
 * separate, deliberate step on the gated CLI. The command carries adapter/proposal/target NAMES and
 * payload TEXT only — never a secret.
 *
 * WORKER-SAFE (critical — this is imported by the read-only Worker):
 *   - `MutationAdapterId` is an `import type` ONLY (erased at compile time; pulls no runner/pg).
 *   - It deliberately does NOT value-import `suggestion-to-mutation.ts` (which value-imports
 *     `makeIdempotencyKey` → `node:crypto`). Instead it reads the route metadata directly off
 *     `proposedPayload["mutationRoute"]` with a local typed cast — the same shape `readMutationRoute`
 *     reads, but with no Node-only import chain.
 */

import type { CockpitState } from "../../cockpit/cockpit-types.js";
import type {
  ProposalQueueItem,
  ProposalQueueStatus,
  ProposalTier,
} from "../../cockpit/proposals/proposal-types.js";
import type { MutationAdapterId } from "../../execution/execution-dispatch.js";
import {
  buildMutationCenterModel,
  type MutationCenterRow,
} from "../../cockpit/mutation/mutation-center.js";

/**
 * Where the dispatcher route metadata rides on a proposal (set by the Wave-1 mapper,
 * `suggestion-to-mutation.ts`). Kept as a LOCAL literal so this view need not value-import that
 * module (which transitively pulls `node:crypto` and would poison the Worker bundle). Must stay
 * in sync with `ADAPTER_ROUTE_KEY` there.
 */
const ADAPTER_ROUTE_KEY = "mutationRoute" as const;

/** The only status from which the gated CLI can actually fire (Key 1 granted). */
const EXECUTION_READY_STATUS: ProposalQueueStatus = "approved_for_execution";

/**
 * The dispatcher adapter ids the `mutate` CLI accepts. Kept as a LOCAL const set (the values, not
 * just the type) so the view can validate a route-carried `adapterId` is one the CLI knows WITHOUT
 * value-importing `execution-dispatch.ts` (which pulls the runners / pg). `MutationAdapterId` is the
 * type-only mirror; this set is checked against it below so the two never drift.
 */
const KNOWN_ADAPTER_IDS = [
  "refresh-sync",
  "reject-drafts",
  "archive-rejected",
  "clickup-comment",
  "clickup-move-status",
] as const;
// Compile-time guard: every literal above is a MutationAdapterId, and vice-versa. If the
// dispatcher's union changes, this assignment fails to type-check until the set is updated.
const _ADAPTER_PARITY: readonly MutationAdapterId[] = KNOWN_ADAPTER_IDS;
void _ADAPTER_PARITY;

function isKnownAdapterId(value: unknown): value is MutationAdapterId {
  return typeof value === "string" && (KNOWN_ADAPTER_IDS as readonly string[]).includes(value);
}

/**
 * Read the route-carried `adapterId` off a proposal's descriptive payload, the SAME shape
 * `readMutationRoute` reads — but inline, so no Node-only import chain is pulled into the Worker.
 * Returns the validated `MutationAdapterId`, or null when absent/malformed/unknown.
 */
function readRouteAdapterId(item: ProposalQueueItem): MutationAdapterId | null {
  const raw = item.proposedPayload?.[ADAPTER_ROUTE_KEY] as { adapterId?: unknown } | undefined;
  if (!raw || typeof raw !== "object") return null;
  return isKnownAdapterId(raw.adapterId) ? raw.adapterId : null;
}

/**
 * LOCAL, conservative, documented fallback: map a proposal's (domain, actionType) to a dispatcher
 * adapter ONLY for the two unambiguous internal queue cleanups. This NEVER guesses an external
 * (ClickUp) adapter from a heuristic — those carry an explicit confirmed target and MUST arrive via
 * the route key. The internal cleanups are bulk-by-status with no free-text ambiguity, so the
 * (domain=system, actionType=sync_repair_plan) shape alone is still not enough to pick reject-drafts
 * vs archive-rejected — so even here we require the route key for the specific adapter. Hence this
 * heuristic, by design, resolves NOTHING on its own and always returns null: the route key is the
 * single source of adapter truth, and "no route ⇒ no guess" is the honest contract.
 *
 * It exists as a named seam: if a future, genuinely unambiguous 1:1 (domain,actionType)→adapter
 * mapping is ever introduced, it belongs here behind an explicit, conservative rule — never as a
 * silent default. Until then it stays null-no-guess.
 */
function heuristicAdapterId(_item: ProposalQueueItem): MutationAdapterId | null {
  return null;
}

/** Resolve the adapter: route key first (authoritative), then the conservative heuristic, else null. */
function resolveAdapterId(item: ProposalQueueItem): MutationAdapterId | null {
  return readRouteAdapterId(item) ?? heuristicAdapterId(item);
}

/** Read a string field off a descriptive state bag (beforeState/afterState/proposedPayload). */
function readStringField(bag: Record<string, unknown> | undefined, key: string): string | null {
  if (!bag) return null;
  const v = bag[key];
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

/**
 * A single dispatch-readiness row — the Mutation Center row enriched with the resolved adapter, a
 * dispatch-readiness verdict, the copyable dry-run command, and (when not ready) the honest reason.
 */
export interface MutationDispatchRow {
  /** Proposal id (also `--proposal <id>` in the rendered command). */
  id: string;
  title: string;
  /** The proposal's declared tier, or null when untiered. */
  tier: ProposalTier | null;
  /** Confirmed target (id + name). */
  target: MutationCenterRow["target"];
  /** The cockpit-settable status this row is pending in. */
  status: ProposalQueueStatus;
  /** True iff the tier-payload precondition passed (mirrors the Mutation Center row). */
  payloadComplete: boolean;
  /** The resolved dispatcher adapter, or null when none could be resolved without guessing. */
  adapterId: MutationAdapterId | null;
  /**
   * True iff this row is DISPATCH-READY: payload complete AND adapter resolved AND the status is
   * `approved_for_execution` (Key 1 granted). A `simulated_approved` row is shown but not yet ready.
   */
  dispatchReady: boolean;
  /** When NOT dispatch-ready, the honest reason(s) — never a guess. Empty when ready. */
  notReadyReasons: string[];
  /**
   * The COPYABLE DRY-RUN command a human could paste into the shell to preview this mutation
   * safely. NEVER contains `--execute`. Null when no adapter could be resolved (nothing to render).
   */
  mutateCommand: string | null;
  /** Always the literal "disabled" — this row never executes. */
  executable: "disabled";
}

/** The assembled, read-only mutation-dispatch-readiness model (the `available:true` payload). */
interface MutationDispatchModel {
  origin: "local";
  mode: "read_only_snapshot";
  executable: "disabled";
  note: string;
  /** Total pending-executable rows considered. */
  total: number;
  /** How many of those rows are dispatch-ready. */
  ready: number;
  rows: MutationDispatchRow[];
}

/**
 * The hosted mutation-dispatch-readiness view. When `available`, it carries the dispatch model.
 * When not, it mirrors `mutationCenterView`'s unavailable branch: an honest, zero-row shell.
 */
export type MutationDispatchView =
  | ({ available: true } & MutationDispatchModel)
  | {
      available: false;
      origin: "local";
      mode: "local_only";
      executable: "disabled";
      note: string;
      total: number;
      ready: number;
      rows: [];
    };

/** Shell-quote a value for the rendered command. Single-quote + escape embedded single quotes. */
function shellArg(value: string): string {
  // POSIX-style single-quote escaping: close, insert an escaped quote, reopen. Deterministic; the
  // command is a copyable suggestion, so we render it portably rather than per-OS.
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Render the COPYABLE DRY-RUN `mutate` command for a resolved adapter. NEVER includes `--execute`.
 * Adds `--card`/`--from`/`--to`/`--text` ONLY when those fields are present on the proposal's
 * target/payload (so the human gets a ready-to-run preview when data exists, and a clearly-
 * incomplete-but-honest template — flagged via dispatchReady/notReadyReasons — when it doesn't).
 */
function renderMutateCommand(item: ProposalQueueItem, adapterId: MutationAdapterId): string {
  const parts = ["npm", "run", "mutate", "--", "--adapter", adapterId, "--proposal", shellArg(item.id)];
  const cardId = item.targetId ?? null;
  switch (adapterId) {
    case "clickup-comment": {
      const text = readStringField(item.proposedPayload, "commentText");
      if (cardId) parts.push("--card", shellArg(cardId));
      if (text) parts.push("--text", shellArg(text));
      break;
    }
    case "clickup-move-status": {
      const from = readStringField(item.beforeState, "status");
      const to = readStringField(item.afterState, "status");
      if (cardId) parts.push("--card", shellArg(cardId));
      if (from) parts.push("--from", shellArg(from));
      if (to) parts.push("--to", shellArg(to));
      break;
    }
    // refresh-sync / reject-drafts / archive-rejected take only --proposal (already added).
    default:
      break;
  }
  return parts.join(" ");
}

/** Project one pending-executable proposal onto a dispatch-readiness row. */
function toDispatchRow(item: ProposalQueueItem, centerRow: MutationCenterRow): MutationDispatchRow {
  const adapterId = resolveAdapterId(item);
  const payloadComplete = centerRow.payloadComplete;
  const statusReady = item.status === EXECUTION_READY_STATUS;

  const notReadyReasons: string[] = [];
  if (adapterId === null) {
    notReadyReasons.push(
      "No dispatcher adapter could be resolved without guessing — the proposal carries no " +
        `proposedPayload.${ADAPTER_ROUTE_KEY} adapter route, and no conservative (domain, actionType) ` +
        "rule applies. Re-map it through suggestion-to-mutation so it names its adapter.",
    );
  }
  if (!payloadComplete) {
    notReadyReasons.push(
      "Tier payload is incomplete — see the Mutation Center's refused actions for the missing fields.",
    );
  }
  if (!statusReady) {
    notReadyReasons.push(
      `Status is "${item.status}", not "${EXECUTION_READY_STATUS}" — Key 1 (approve for execution) ` +
        "has not been granted, so the gated CLI would refuse it.",
    );
  }

  const dispatchReady = adapterId !== null && payloadComplete && statusReady;
  const mutateCommand = adapterId !== null ? renderMutateCommand(item, adapterId) : null;

  return {
    id: item.id,
    title: item.title,
    tier: item.tier ?? null,
    target: centerRow.target,
    status: item.status,
    payloadComplete,
    adapterId,
    dispatchReady,
    notReadyReasons,
    mutateCommand,
    executable: "disabled",
  };
}

/**
 * PURE. Project the read-only mutation-dispatch-readiness panel from a cockpit snapshot.
 *
 * - When `state.proposalQueue` is present: builds one row per pending-executable proposal
 *   (simulated_approved / approved_for_execution — sourced from `buildMutationCenterModel`, so the
 *   pending-executable filter and the tier-payload check are the single shared source of truth),
 *   each enriched with its resolved adapter, dispatch-readiness, and a copyable DRY-RUN command.
 * - When `state` / `state.proposalQueue` is absent: returns the honest `available:false` shell,
 *   mirroring `mutationCenterView`'s unavailable branch. No fabricated rows.
 *
 * No I/O, no fetch, no env, no clock — derives the view from the snapshot and nothing else. Every
 * rendered command is a DRY-RUN (never `--execute`); arming stays the human's deliberate step.
 */
export function mutationDispatchView(state: CockpitState | undefined): MutationDispatchView {
  const queue = state?.proposalQueue;
  if (!queue) {
    return {
      available: false,
      origin: "local",
      mode: "local_only",
      executable: "disabled",
      note:
        "Mutation dispatch-readiness is unavailable — no proposal queue is embedded in this " +
        "snapshot. The queue is local-only in the hosted MVP; create/manage proposals from the " +
        "local cockpit (npm run cockpit:web), then re-bake the snapshot.",
      total: 0,
      ready: 0,
      rows: [],
    };
  }

  // Reuse the Mutation Center model as the single source of the pending-executable row set + the
  // pure tier-payload completeness check. We re-pair each model row to its source proposal by id to
  // read the route key + target/payload fields the dispatch command needs.
  const model = buildMutationCenterModel(queue);
  const byId = new Map(queue.map((item) => [item.id, item] as const));
  const rows: MutationDispatchRow[] = model.rows.map((centerRow) => {
    const item = byId.get(centerRow.id);
    // `centerRow` is always derived from a queue item, so `item` is present; the guard is defensive.
    return item
      ? toDispatchRow(item, centerRow)
      : {
          id: centerRow.id,
          title: centerRow.title,
          tier: centerRow.tier ?? null,
          target: centerRow.target,
          status: centerRow.status,
          payloadComplete: centerRow.payloadComplete,
          adapterId: null,
          dispatchReady: false,
          notReadyReasons: ["Source proposal not found in the snapshot queue."],
          mutateCommand: null,
          executable: "disabled" as const,
        };
  });

  const ready = rows.filter((r) => r.dispatchReady).length;
  const note =
    rows.length === 0
      ? "Read-only mutation dispatch-readiness projection. No rows are pending-executable in this " +
        "snapshot. This does NOT mean nothing is approved — the hosted spine clamps live/executor " +
        "statuses out of the snapshot, so approved actions may exist on the separate gated live " +
        "surface and simply not be visible here."
      : "Read-only mutation dispatch-readiness projection of the local proposal queue. Each row " +
        "names the dispatcher adapter that would handle the proposal and a COPYABLE DRY-RUN " +
        "`npm run mutate` command — a safe preview-only starting point. Arming (the CLI's " +
        "real-run flag plus the per-adapter ALLOW_EXEC_* env flag, kill-switch off) is the " +
        "human's separate, deliberate step on the gated CLI. Nothing runs from this view.";

  return {
    available: true,
    origin: "local",
    mode: "read_only_snapshot",
    executable: "disabled",
    note,
    total: rows.length,
    ready,
    rows,
  };
}
