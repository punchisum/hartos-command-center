/**
 * src/awareness/supabase-memory-store.ts
 *
 * Step 2b — Node-side durable MemoryStore for the Executive Memory spine.
 *
 * This is the missing durable backend the memory loop needed (only an ephemeral
 * InMemoryMemoryStore existed). It implements the `MemoryStore` port over an injected
 * `Queryable` (a pg Pool/Client satisfies it), so this module imports NO database
 * driver and stays unit-testable with a fake query spy — no live DB in the suite.
 *
 * `save(list)` makes the table EQUAL the supplied list (the capture policy already
 * deduped-by-day, window-pruned, and capped it): upsert each row by UTC day, then
 * drop any day no longer present. Idempotent. The same secret guard the proposal
 * spine uses runs before any write — we never persist secret-looking content.
 *
 * NODE-HOST ONLY at the write edge; the contract + coercion stay pure. The Worker
 * reads via the anon RPC (cockpit-memory-spine.ts), never this store.
 */

import { containsSecret } from "../llm/redaction.js";
import type { MemorySnapshot } from "./executive-memory.js";
import type { MemoryStore } from "./memory-store.js";

/** Minimal DB surface this store needs. A pg `Pool`/`Client` satisfies it. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rowCount?: number | null; rows: unknown[] }>;
}

export const MEMORY_SNAPSHOT_UPSERT_SQL = `insert into public.cockpit_memory_snapshots (day, captured_at, snapshot, synced_at)
 values ($1, $2, $3::jsonb, now())
 on conflict (day) do update set
   captured_at = excluded.captured_at,
   snapshot    = excluded.snapshot,
   synced_at   = now()`;

export const MEMORY_SNAPSHOT_SELECT_SQL =
  `select snapshot from public.cockpit_memory_snapshots order by captured_at asc`;

/** Drop any day not in the supplied list (keeps the table equal to the policied list). */
export const MEMORY_SNAPSHOT_PRUNE_SQL =
  `delete from public.cockpit_memory_snapshots where day <> all($1::text[])`;

export const MEMORY_SNAPSHOT_DELETE_ALL_SQL = `delete from public.cockpit_memory_snapshots`;

/** UTC calendar day for a snapshot's ISO timestamp (matches the capture policy). */
function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export class SupabaseMemoryStore implements MemoryStore {
  constructor(private readonly db: Queryable) {}

  /** Read the full snapshot history (oldest→newest). Malformed rows are skipped. */
  async read(): Promise<MemorySnapshot[]> {
    const res = await this.db.query(MEMORY_SNAPSHOT_SELECT_SQL);
    const out: MemorySnapshot[] = [];
    for (const row of res.rows) {
      const snap = (row as { snapshot?: unknown }).snapshot;
      if (snap && typeof snap === "object" && typeof (snap as { at?: unknown }).at === "string") {
        out.push(snap as MemorySnapshot);
      }
    }
    return out;
  }

  /**
   * Replace the stored history with the given (already-policied) list. Upsert each by
   * UTC day, then prune days not present. Refuses any snapshot whose JSON looks like it
   * contains a secret (same guard as the filesystem/proposal stores).
   */
  async save(list: MemorySnapshot[]): Promise<void> {
    const days: string[] = [];
    for (const snap of list) {
      const json = JSON.stringify(snap);
      if (containsSecret(json)) {
        throw new Error(`Refusing to persist memory snapshot ${snap.at}: secret-looking content detected.`);
      }
      const day = dayKey(snap.at);
      days.push(day);
      await this.db.query(MEMORY_SNAPSHOT_UPSERT_SQL, [day, snap.at, json]);
    }
    if (days.length === 0) {
      await this.db.query(MEMORY_SNAPSHOT_DELETE_ALL_SQL);
    } else {
      await this.db.query(MEMORY_SNAPSHOT_PRUNE_SQL, [days]);
    }
  }
}
