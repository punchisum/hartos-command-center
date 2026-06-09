/**
 * src/runtime/views/audit-from-proposals.ts
 *
 * FU-2 — give the hosted Audit Trail panel a real LOCAL data source with ZERO new
 * infrastructure. The pg-backed audit reader (`fetchAuditTail` in src/execution/audit-tail.ts)
 * is Node-only, so the hosted Worker hands `auditTailView` a `null` (honest-unavailable). But
 * every live proposal already carries its OWN append-only audit events in the Worker-resolved
 * `CockpitState`: `ProposalQueueItem.auditEvents: ProposalAuditEvent[]` ({ at, event, detail? }).
 *
 * This module flattens those per-proposal events into the SAME `AuditRow[]` shape the view
 * already consumes — so the panel goes LIVE off the snapshot the Worker already resolves, with
 * no pg, no fs, no crypto, no new store.
 *
 * STRICT WORKER-SAFETY: the only imports are `import type` (erased at compile time). It pulls in
 * NO pg / node:fs / node:path / node:crypto value import. A value leak would poison the Worker
 * bundle. PURE + deterministic: derives rows from the snapshot and nothing else — no I/O, no
 * fetch, no env, no ambient clock. Doctrine: never fabricates a status (honest `null` when an
 * event does not itself encode a known lifecycle status); surfaces no secret (event names only).
 */

import type { AuditRow } from "../../execution/audit-tail.js";
import type { CockpitState } from "../../cockpit/cockpit-types.js";
import type {
  ProposalQueueItem,
  ProposalAuditEvent,
  ProposalQueueStatus,
} from "../../cockpit/proposals/proposal-types.js";

/**
 * The set of known queue statuses. An audit event whose `event` name IS exactly one of these
 * literally records a transition TO that status, so deriving `toStatus` from it is honest (not
 * fabricated). Any other event name (e.g. "proposed", "edited") has no encoded target status, so
 * `toStatus` stays `null`. We never invent a status from free-form `detail` text.
 */
const KNOWN_STATUSES: ReadonlySet<string> = new Set<ProposalQueueStatus>([
  "draft",
  "pending_approval",
  "simulated_approved",
  "approved_for_execution",
  "executing",
  "executed",
  "execution_failed",
  "runtime_provisioned",
  "rejected",
  "expired",
]);

/**
 * Safe, non-fabricating derivation of `toStatus` for one proposal audit event.
 *
 * `ProposalAuditEvent` has no `status` field — only `{ at, event, detail? }`. The only honest
 * signal of a target status is when the `event` name IS itself a known `ProposalQueueStatus`
 * (the append-only audit log records transitions by their target-status name). In that case the
 * event literally encodes the status it moved TO. For every other event we return `null` rather
 * than guess — doctrine forbids laundering a fabricated status into the audit trail.
 */
function deriveToStatus(ev: ProposalAuditEvent): string | null {
  return KNOWN_STATUSES.has(ev.event) ? ev.event : null;
}

/** Map one proposal's audit event into an `AuditRow` (proposalId stamped from the item). */
function toAuditRow(item: ProposalQueueItem, ev: ProposalAuditEvent): AuditRow {
  return {
    proposalId: item.id,
    event: ev.event,
    toStatus: deriveToStatus(ev),
    at: ev.at,
  };
}

/**
 * PURE + deterministic + Worker-safe. Flatten every `auditEvents` entry across every proposal in
 * `state.proposalQueue` into a single newest-first `AuditRow[]`.
 *
 * - Returns `null` when `state` or `state.proposalQueue` is absent — so `auditTailView(null)`
 *   shows the honest "no provider" unavailable shell (NOT a fabricated empty trail).
 * - Returns `[]` (an EMPTY array, distinct from `null`) when the queue is present but carries no
 *   audit events — so `auditTailView([])` shows the honest empty-state note.
 * - Otherwise returns every event as an `AuditRow`, sorted newest-first by `at` (matching the
 *   `order by at desc` contract of the pg `fetchAuditTail` this stands in for). The sort is a
 *   stable string compare on the ISO `at`; ties keep their flattened (queue/event) order.
 *
 * No pg, no fs, no crypto, no clock, no env. The output carries event NAMES only — never a
 * proposal payload, beforeState/afterState, or any secret.
 */
export function auditRowsFromProposals(
  state: CockpitState | undefined | null,
): AuditRow[] | null {
  const queue = state?.proposalQueue;
  if (!queue) return null;

  const rows: AuditRow[] = [];
  for (const item of queue) {
    const events = item.auditEvents;
    if (!events) continue;
    for (const ev of events) {
      rows.push(toAuditRow(item, ev));
    }
  }

  // Newest-first by ISO `at`. ISO-8601 timestamps sort lexicographically the same as
  // chronologically; a non-string `at` is coerced for the compare only (the row keeps `ev.at`).
  rows.sort((a, b) => {
    const aAt = String(a.at);
    const bAt = String(b.at);
    if (aAt < bAt) return 1;
    if (aAt > bAt) return -1;
    return 0;
  });

  return rows;
}
