/**
 * src/runtime/views/audit-tail-view.ts
 *
 * Phase (3-levels-up master plan) — a PURE, Worker-safe read-only cockpit view-builder that
 * projects an already-fetched audit tail (the immutable who/what/when of every executed
 * mutation + lifecycle transition, from public.cockpit_proposal_audit) into a hosted-cockpit
 * panel. It mirrors `mutationCenterView` (src/runtime/views/mutation-center-view.ts): the same
 * `{ available, mode, executable: "disabled", note, ... }` shape and the same honest
 * available/unavailable branching the other live panels use to degrade.
 *
 * STRICT SEPARATION OF CONCERNS:
 *   - The DATA path — a provider/resolver that runs the pg SELECT (`fetchAuditTail` in
 *     src/execution/audit-tail.ts) and hands `AuditRow[]` to this view — is Node-only and is
 *     the Commander's wiring / go-live concern. This view NEVER reaches for it.
 *   - This file is the VIEW only: given rows (or null/undefined), it projects a read-only
 *     model. It imports nothing that fetches, mutates, persists, or executes; it reads no
 *     filesystem, network, pg/Supabase, env, or ambient clock; `executable` is the literal
 *     `"disabled"` — never a button, never `true`.
 *
 * Worker-safety is load-bearing: the ONLY import here is `import type { AuditRow }` (a type,
 * erased at compile time) plus the PURE `formatAuditTail` (string formatting only — no pg, no
 * I/O). `fetchAuditTail` (which uses pg) is NEVER imported. A pg leak would poison the Worker
 * bundle.
 */

import type { AuditRow } from "../../execution/audit-tail.js";
import { formatAuditTail } from "../../execution/audit-tail.js";

/** The provider seam (Commander's wiring): a resolver supplies rows, or null to decline. */
export type AuditTailProviderResult = AuditRow[] | null;

/** One projected, read-only audit line — a safe, presentational subset of an AuditRow. */
export interface AuditTailViewRow {
  /** Stable ISO-8601 timestamp (normalized from the source `at`, whether Date or string). */
  at: string;
  /** The lifecycle/mutation event name (e.g. "approved_for_execution", "executed"). */
  event: string;
  /** The transition's target status, or null for a transition without one. */
  toStatus: string | null;
  /** The proposal this row belongs to. */
  proposalId: string;
  /** A short, single-line human detail summarizing the row. */
  detail: string;
}

/**
 * The hosted Audit Trail panel view. A read-only snapshot projection — no execution surface.
 * `available: true` carries the projected rows + a rendered block; `available: false` is the
 * honest, zero-row "no provider" shell (mirrors `mutationCenterView`'s unavailable branch).
 */
export type AuditTailView =
  | {
      available: true;
      mode: "read_only_snapshot";
      executable: "disabled";
      note: string;
      total: number;
      rows: AuditTailViewRow[];
      /** The aligned, newline-joined human block from the PURE `formatAuditTail`. */
      rendered: string;
    }
  | {
      available: false;
      mode: "read_only_snapshot";
      executable: "disabled";
      note: string;
      total: 0;
      rows: [];
      rendered: "";
    };

export interface AuditTailViewOptions {
  /** Cap the projected rows (newest-first). Omitted/<=0 ⇒ no cap. Pure clamp, no I/O. */
  limit?: number;
}

/** Normalize an `at` (Date or string) to a stable ISO string. Deterministic for fixed input. */
function isoAt(at: Date | string): string {
  if (at instanceof Date) return at.toISOString();
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime()) ? at : parsed.toISOString();
}

/** Project one AuditRow into a safe, presentational read-only row (no value-leak). */
function projectRow(row: AuditRow): AuditTailViewRow {
  const at = isoAt(row.at);
  const toStatus = row.toStatus;
  const detail =
    toStatus == null
      ? `${row.event} (${row.proposalId})`
      : `${row.event} → ${toStatus} (${row.proposalId})`;
  return {
    at,
    event: row.event,
    toStatus,
    proposalId: row.proposalId,
    detail,
  };
}

/**
 * PURE. Project the read-only Audit Trail panel from an already-fetched audit tail.
 *
 * - `rows` null/undefined ⇒ honest `available: false` shell with zero rows and a note that
 *   says the audit trail is unavailable because no audit provider is configured. NEVER
 *   fabricates rows (mirrors `mutationCenterView`'s honest-unavailable branch).
 * - `rows` present (INCLUDING an empty array) ⇒ `available: true`. Each AuditRow is projected
 *   into a safe read-only row; newest-first ordering is preserved (the source tail is already
 *   `order by at desc`, and this view does not re-sort — it preserves the supplied order). An
 *   empty array gets an honest empty-state note that is DISTINCT from the unavailable note.
 *   `rendered` reuses the PURE `formatAuditTail` for an aligned human block.
 *
 * No I/O, no fetch, no env, no clock, no pg — derives the view from the rows and nothing else.
 */
export function auditTailView(
  rows: AuditRow[] | null | undefined,
  opts: AuditTailViewOptions = {},
): AuditTailView {
  if (rows == null) {
    return {
      available: false,
      mode: "read_only_snapshot",
      executable: "disabled",
      note:
        "Audit trail unavailable — no audit provider configured; set up the read path " +
        "(the Node-only audit tail reader over the immutable cockpit_proposal_audit log) to " +
        "surface it. This panel is a read-only projection and never reads the DB itself.",
      total: 0,
      rows: [],
      rendered: "",
    };
  }

  // Present (possibly empty). Preserve the supplied newest-first order; clamp only.
  const limit = typeof opts.limit === "number" && opts.limit > 0 ? opts.limit : undefined;
  const source = limit === undefined ? rows : rows.slice(0, limit);
  const projected = source.map(projectRow);

  const note =
    projected.length === 0
      ? "Read-only Audit Trail projection. No audit rows are present in this snapshot — the " +
        "immutable cockpit_proposal_audit log has no entries to surface yet (no mutation or " +
        "lifecycle transition has been recorded). This is an empty audit trail, not an " +
        "unavailable one."
      : "Read-only Audit Trail projection of the immutable cockpit_proposal_audit log " +
        "(newest first). This panel is a snapshot only and cannot mutate or replay the log.";

  return {
    available: true,
    mode: "read_only_snapshot",
    executable: "disabled",
    note,
    total: projected.length,
    rows: projected,
    // PURE: `formatAuditTail` is string-formatting only (no pg, no I/O). Render the same
    // clamped source rows so the block matches the projected `rows`.
    rendered: formatAuditTail(source),
  };
}
