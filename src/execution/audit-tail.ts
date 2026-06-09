/**
 * src/execution/audit-tail.ts — read-only tail over the append-only proposal audit log.
 *
 * A pure, injectable read-side: fetch the most-recent rows of public.cockpit_proposal_audit
 * (the immutable who/what/when of every cockpit proposal transition — see the Phase 2.3
 * migration) and render them as aligned, human-readable lines. The DB seam is the same
 * `Queryable` the executor store uses, so a test can inject a fake query — no live connection.
 *
 * This is the READ side only: it SELECTs, never writes. The audit table is insert-only by
 * design (UPDATE/DELETE are not granted), so a tail can never mutate it.
 */

import type { Queryable } from "./run-refresh-sync-db.js";

/** One audit row, as projected from public.cockpit_proposal_audit (columns confirmed in the migration). */
export interface AuditRow {
  proposalId: string;
  event: string;
  /** Nullable in the schema (`to_status text`); a transition without a target status. */
  toStatus: string | null;
  /** `at timestamptz` — pg may hand back a Date or an ISO string depending on the driver config. */
  at: Date | string;
}

/** The newest-first tail query. `$1` is the row limit. */
const TAIL_SQL =
  "select proposal_id, event, to_status, at from public.cockpit_proposal_audit order by at desc limit $1";

/**
 * Read the newest `limit` audit rows (newest first) over any `Queryable`. Pure: it issues a
 * single SELECT and maps the raw rows into `AuditRow`s, preserving a Date `at` as-is (the
 * formatter normalizes it) and a null `to_status` as `null`.
 */
export async function fetchAuditTail(db: Queryable, limit: number): Promise<AuditRow[]> {
  const r = await db.query(TAIL_SQL, [limit]);
  return r.rows.map((row) => {
    const atRaw = row.at;
    const toStatusRaw = row.to_status;
    return {
      proposalId: String(row.proposal_id ?? ""),
      event: String(row.event ?? ""),
      toStatus: toStatusRaw == null ? null : String(toStatusRaw),
      at: atRaw instanceof Date ? atRaw : String(atRaw ?? ""),
    };
  });
}

/** Normalize `at` to a stable ISO string whether the driver gave us a Date or a string. */
function formatAt(at: Date | string): string {
  if (at instanceof Date) return at.toISOString();
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime()) ? at : parsed.toISOString();
}

/**
 * Render rows as aligned, human-readable lines (one per row). Columns: timestamp, event,
 * to-status (null shown as "-"), proposal id. Pads each column to the widest value so the
 * output lines up in a terminal. Returns a single newline-joined string ("" for no rows).
 */
export function formatAuditTail(rows: AuditRow[]): string {
  if (rows.length === 0) return "(no audit rows)";

  const cells = rows.map((row) => ({
    at: formatAt(row.at),
    event: row.event,
    toStatus: row.toStatus ?? "-",
    proposalId: row.proposalId,
  }));

  const widthAt = Math.max(...cells.map((c) => c.at.length));
  const widthEvent = Math.max(...cells.map((c) => c.event.length));
  const widthToStatus = Math.max(...cells.map((c) => c.toStatus.length));

  return cells
    .map(
      (c) =>
        `${c.at.padEnd(widthAt)}  ${c.event.padEnd(widthEvent)}  ${c.toStatus.padEnd(widthToStatus)}  ${c.proposalId}`,
    )
    .join("\n");
}
