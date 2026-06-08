/**
 * src/cockpit/proposals/supabase-proposal-store.ts
 *
 * Phase D — Node-side WRITE store for the cockpit proposal spine.
 *
 * Doctrine: this is the WRITE half (Node only). It upserts proposals into the
 * fitness project's `cockpit_proposals` table using an elevated DB role, so the
 * hosted read-only Worker can later READ them via the anon RPC. It runs the same
 * secret check the filesystem queue does before any write.
 *
 * It depends ONLY on an injected `Queryable` (a pg Pool/Client satisfies it), so
 * this module imports no database driver and stays trivially unit-testable with
 * a fake query spy — no live DB, no network in the test suite.
 */

import { containsSecret } from "../../llm/redaction.js";
import type { ProposalQueueItem } from "./proposal-types.js";

/** Minimal DB surface this store needs. A pg `Pool`/`Client` satisfies it. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rowCount?: number | null; rows: unknown[] }>;
}

export const COCKPIT_PROPOSALS_UPSERT_SQL = `insert into public.cockpit_proposals
  (id, domain, action_type, title, risk_level, status, source_intent, spec_id,
   created_at, updated_at, expires_at, payload, synced_at)
 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, now())
 on conflict (id) do update set
   domain        = excluded.domain,
   action_type   = excluded.action_type,
   title         = excluded.title,
   risk_level    = excluded.risk_level,
   status        = excluded.status,
   source_intent = excluded.source_intent,
   spec_id       = excluded.spec_id,
   updated_at    = excluded.updated_at,
   expires_at    = excluded.expires_at,
   payload       = excluded.payload,
   synced_at     = now()`;

export interface SyncResult {
  upserted: number;
  failed: number;
  /** Ids that were refused (secret-looking content) or errored, for honest reporting. */
  skipped: string[];
}

export class SupabaseProposalStore {
  constructor(private readonly db: Queryable) {}

  /** Build the positional params for one item (exported shape for tests). */
  static params(item: ProposalQueueItem, payloadJson: string): unknown[] {
    return [
      item.id,
      item.domain,
      item.actionType,
      item.title,
      item.riskLevel,
      item.status,
      item.sourceIntent ?? null,
      item.specId ?? null,
      item.createdAt,
      item.updatedAt,
      item.expiresAt ?? null,
      payloadJson,
    ];
  }

  /**
   * Upsert one proposal. Throws if the serialized item looks like it contains a
   * secret (same guard as the filesystem queue) — we never persist secrets.
   */
  async upsert(item: ProposalQueueItem): Promise<void> {
    const payloadJson = JSON.stringify(item);
    if (containsSecret(payloadJson)) {
      throw new Error(`Refusing to upsert proposal ${item.id}: secret-looking content detected.`);
    }
    await this.db.query(COCKPIT_PROPOSALS_UPSERT_SQL, SupabaseProposalStore.params(item, payloadJson));
  }

  /**
   * Best-effort batch upsert (used for backfill + dual-write). A single failed
   * item never aborts the batch: it is counted and its id recorded.
   */
  async upsertMany(items: ProposalQueueItem[]): Promise<SyncResult> {
    let upserted = 0;
    let failed = 0;
    const skipped: string[] = [];
    for (const item of items) {
      try {
        await this.upsert(item);
        upserted += 1;
      } catch {
        failed += 1;
        skipped.push(item.id);
      }
    }
    return { upserted, failed, skipped };
  }
}
