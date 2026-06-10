/**
 * src/awareness/supabase-memory-db.ts
 *
 * Step 2b — Node-ONLY pg adapter for the Executive Memory spine. Mirrors
 * supabase-proposal-db: it is the only memory module that imports the postgres
 * driver, so pg never enters the read-only Worker bundle. Builds a
 * SupabaseMemoryStore over a pooled connection to HARTOS_SUPABASE_DB_URL (the
 * fitness project, elevated role), with strict TLS when a Supabase CA is configured.
 */

import pg from "pg";
import { SupabaseMemoryStore, type Queryable } from "./supabase-memory-store.js";
import { buildSupabaseSsl, type SupabaseTlsMode } from "../lib/supabase-tls.js";

const { Pool } = pg;

/** The env var holding the elevated (RLS-bypassing) Postgres connection string. */
export const MEMORY_SPINE_DB_URL_ENV = "HARTOS_SUPABASE_DB_URL";

export interface MemoryDbHandle {
  store: SupabaseMemoryStore;
  /** "strict" = chain-verified against the Supabase CA; "relaxed" = no CA configured. */
  tlsMode: SupabaseTlsMode;
  /** Close the underlying pool. Always call this when done. */
  close: () => Promise<void>;
}

/**
 * Build a pg-backed memory store from env, or null when the DB URL is absent
 * (local dev without the spine configured — callers then no-op gracefully).
 */
export function createCockpitMemoryDb(env: NodeJS.ProcessEnv = process.env): MemoryDbHandle | null {
  const connectionString = env[MEMORY_SPINE_DB_URL_ENV];
  if (!connectionString || connectionString.trim().length === 0) return null;

  const { ssl, tlsMode } = buildSupabaseSsl(env);
  if (tlsMode === "relaxed") {
    console.warn(
      "[cockpit-memory-db] TLS chain verification disabled (no HARTOS_SUPABASE_CA configured). " +
        "Set HARTOS_SUPABASE_CA or HARTOS_SUPABASE_CA_PATH to enable strict verification.",
    );
  }
  const pool = new Pool({ connectionString, max: 2, ssl });
  const db: Queryable = { query: (text, params) => pool.query(text, params) };
  return {
    store: new SupabaseMemoryStore(db),
    tlsMode,
    close: () => pool.end(),
  };
}
