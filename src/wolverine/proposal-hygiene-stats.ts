/**
 * src/wolverine/proposal-hygiene-stats.ts — the ONE source of the proposal-hygiene counts.
 *
 * The proposal-hygiene detector (src/wolverine/detectors/proposal-hygiene.ts) only emits its findings
 * (proposal:aging-drafts, proposal:rejected-to-archive) when it is given ProposalStats. Any caller of
 * wolverineAudit that wants those findings in the repairQueue MUST gather stats first. This module is
 * the shared gatherer so callers (wolverine-propose, the outcome observer) cannot silently diverge —
 * an omission here was what made the outcome observer false-score those subjects as "resolved".
 */
import type { ProposalStats } from "./wolverine-types.js";

export const AGING_HOURS = 72;

/** Precise hygiene counts (pg): aging drafts; rejected NOT already archived (excludes done fixes). */
export const HYGIENE_SQL = `
  select
    count(*) filter (where status in ('draft','pending_approval')
                       and created_at < now() - make_interval(hours => $1::int))            as aging,
    count(*) filter (where status = 'rejected'
                       and coalesce(payload->>'archived','') <> 'true')                      as rejected
  from public.cockpit_proposals`;

/** Minimal DB shape (satisfied by createCockpitProposalDb's handle). */
export interface HygieneDb {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

/** Read the live spine and return the ProposalStats the proposal-hygiene detector needs. */
export async function gatherProposalStats(db: HygieneDb): Promise<ProposalStats> {
  const res = await db.query(HYGIENE_SQL, [AGING_HOURS]);
  const row = (res.rows[0] ?? {}) as { aging?: unknown; rejected?: unknown };
  return {
    agingDraftCount: Number(row.aging ?? 0),
    rejectedCount: Number(row.rejected ?? 0),
    agingHours: AGING_HOURS,
  };
}
