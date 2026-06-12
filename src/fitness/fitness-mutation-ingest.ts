/**
 * src/fitness/fitness-mutation-ingest.ts — P5: ingest polled pending mutations into the spine.
 *
 * The command-center live-runner polls get_pending_mutations (fitness side, same DB — Hart Personal
 * Core) and ingests each into cockpit_proposals as a pending_approval fitness proposal that rides
 * the gated spine. Idempotent by the deterministic proposal id (ON CONFLICT DO NOTHING) so
 * re-polling the same pending mutation never duplicates. Core over an injected Queryable; the RPC
 * poll itself is host glue (the live-runner). NODE-HOST ONLY (writes the spine). Never the Worker.
 */

import { pendingFitnessMutationToProposal, type PendingFitnessMutation } from "./fitness-mutation-materialize.js";

/** Minimal pg surface — matches the cockpit proposal db handle; tests inject a fake. */
export interface FitnessIngestDb {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

export interface FitnessIngestSummary {
  ingested: number;
  skipped: number;
  ids: string[];
}

/**
 * Materialise each pending fitness mutation and insert it into the spine (pending_approval).
 * Idempotent: the deterministic id + ON CONFLICT DO NOTHING means an already-present proposal is
 * skipped. The approval floor (Hart, or the armed autoheal class) + the gated executor still decide
 * whether anything runs — this only enqueues.
 */
export async function ingestPendingFitnessMutations(
  db: FitnessIngestDb,
  pending: PendingFitnessMutation[],
  now: Date,
): Promise<FitnessIngestSummary> {
  let ingested = 0;
  let skipped = 0;
  const ids: string[] = [];

  for (const m of pending) {
    const p = pendingFitnessMutationToProposal(m, now);
    const ins = await db.query(
      `insert into public.cockpit_proposals (id, domain, action_type, title, risk_level, status, source_intent, created_at, updated_at, expires_at, payload)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$8,null,$9)
       on conflict (id) do nothing`,
      [p.id, p.domain, p.actionType, p.title, p.riskLevel, p.status, p.sourceIntent, now.toISOString(), JSON.stringify(p)],
    );
    if ((ins.rowCount ?? 0) === 1) {
      await db.query(
        `insert into public.cockpit_proposal_audit (proposal_id, event, to_status) values ($1, 'fitness_materialized', $2)`,
        [p.id, p.status],
      );
      ingested += 1;
      ids.push(p.id);
    } else {
      skipped += 1;
    }
  }

  return { ingested, skipped, ids };
}
