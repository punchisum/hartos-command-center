/**
 * src/rinnegan/context-pack-db.ts — Node-only pg adapter for the Rinnegan context pack.
 *
 * Writes the vault's note metadata + body excerpt into public.cockpit_context_pack (elevated DB
 * role) so the read-only Worker can read it via the anon RPC. Mirrors the proposal-spine pg
 * pattern; the only module here that imports pg.
 */

import pg from "pg";
import { buildSupabaseSsl } from "../lib/supabase-tls.js";

const { Pool } = pg;

export const CONTEXT_PACK_DB_URL_ENV = "HARTOS_SUPABASE_DB_URL";

export interface ContextPackDbHandle {
  query: (text: string, params?: unknown[]) => Promise<{ rowCount?: number | null; rows: unknown[] }>;
  close: () => Promise<void>;
}

export function createContextPackDb(env: NodeJS.ProcessEnv = process.env): ContextPackDbHandle | null {
  const connectionString = env[CONTEXT_PACK_DB_URL_ENV];
  if (!connectionString || connectionString.trim().length === 0) return null;
  const { ssl } = buildSupabaseSsl(env);
  const pool = new Pool({ connectionString, max: 2, ssl });
  return { query: (text, params) => pool.query(text, params), close: () => pool.end() };
}

export const CONTEXT_PACK_UPSERT_SQL = `insert into public.cockpit_context_pack
  (rel_path, title, tags, folder, body_excerpt, review_by, age_days, synced_at)
 values ($1, $2, $3, $4, $5, $6, $7, now())
 on conflict (rel_path) do update set
   title = excluded.title, tags = excluded.tags, folder = excluded.folder,
   body_excerpt = excluded.body_excerpt, review_by = excluded.review_by,
   age_days = excluded.age_days, synced_at = now()`;

/** Drop pack rows for notes no longer present in the vault (keeps the pack == the vault). */
export const CONTEXT_PACK_PRUNE_SQL = `delete from public.cockpit_context_pack where rel_path <> all($1::text[])`;
