/**
 * src/cockpit/threads/supabase-thread-store.ts
 *
 * Phase D — Node-side WRITE store for the cockpit thread spine. Mirrors
 * supabase-proposal-store.ts: it upserts threads into the fitness project's
 * `cockpit_threads` table using an elevated DB role, so the hosted read-only
 * Worker can later READ them via the anon RPC. Runs the same secret check before
 * any write. Depends ONLY on an injected `Queryable` (a pg Pool/Client satisfies
 * it), so this module imports no database driver and is trivially unit-testable.
 */

import { containsSecret } from "../../llm/redaction.js";
import type { CockpitThread } from "../cockpit-types.js";
import { threadToSpineRow } from "./cockpit-thread-spine.js";

/** Minimal DB surface this store needs. A pg `Pool`/`Client` satisfies it. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rowCount?: number | null; rows: unknown[] }>;
}

export const COCKPIT_THREADS_UPSERT_SQL = `insert into public.cockpit_threads
  (thread_id, created_at, updated_at, entry_count, latest_request, latest_intent,
   latest_summary, payload, synced_at)
 values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
 on conflict (thread_id) do update set
   created_at     = excluded.created_at,
   updated_at     = excluded.updated_at,
   entry_count    = excluded.entry_count,
   latest_request = excluded.latest_request,
   latest_intent  = excluded.latest_intent,
   latest_summary = excluded.latest_summary,
   payload        = excluded.payload,
   synced_at      = now()`;

export interface SyncResult {
  upserted: number;
  failed: number;
  /** Thread ids that were refused (secret-looking content) or errored. */
  skipped: string[];
}

export class SupabaseThreadStore {
  constructor(private readonly db: Queryable) {}

  /** Build the positional params for one thread (exported shape for tests). */
  static params(thread: CockpitThread, payloadJson: string): unknown[] {
    const row = threadToSpineRow(thread);
    return [
      row.thread_id,
      row.created_at,
      row.updated_at,
      row.entry_count,
      row.latest_request,
      row.latest_intent,
      row.latest_summary,
      payloadJson,
    ];
  }

  /** Upsert one thread. Throws if the serialized thread looks like it has a secret. */
  async upsert(thread: CockpitThread): Promise<void> {
    const payloadJson = JSON.stringify(thread);
    if (containsSecret(payloadJson)) {
      throw new Error(`Refusing to upsert thread ${thread.threadId}: secret-looking content detected.`);
    }
    await this.db.query(COCKPIT_THREADS_UPSERT_SQL, SupabaseThreadStore.params(thread, payloadJson));
  }

  /** Best-effort batch upsert. A single failed thread never aborts the batch. */
  async upsertMany(threads: CockpitThread[]): Promise<SyncResult> {
    let upserted = 0;
    let failed = 0;
    const skipped: string[] = [];
    for (const thread of threads) {
      try {
        await this.upsert(thread);
        upserted += 1;
      } catch {
        failed += 1;
        skipped.push(thread.threadId);
      }
    }
    return { upserted, failed, skipped };
  }
}
