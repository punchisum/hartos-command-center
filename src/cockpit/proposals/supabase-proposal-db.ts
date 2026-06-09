/**
 * src/cockpit/proposals/supabase-proposal-db.ts
 *
 * Phase D — Node-ONLY pg adapter for the cockpit proposal spine.
 *
 * This is the ONLY module that imports the postgres driver. It is never reached
 * from the hosted Worker (which is read-only and ships no DB driver); keeping pg
 * isolated here guarantees it never enters the Worker bundle. It builds a
 * SupabaseProposalStore over a pooled connection to HARTOS_SUPABASE_DB_URL (the
 * fitness project, elevated role) and offers a filesystem → spine backfill.
 */

import pg from "pg";
import { SupabaseProposalStore, type Queryable, type SyncResult } from "./supabase-proposal-store.js";
import { listProposals } from "./proposal-queue.js";
import { buildSupabaseSsl, type SupabaseTlsMode } from "../../lib/supabase-tls.js";

const { Pool } = pg;

/** The env var holding the elevated (RLS-bypassing) Postgres connection string. */
export const COCKPIT_SPINE_DB_URL_ENV = "HARTOS_SUPABASE_DB_URL";

export interface ProposalDbHandle {
  store: SupabaseProposalStore;
  /** "strict" = chain-verified against the Supabase CA; "relaxed" = no CA configured. */
  tlsMode: SupabaseTlsMode;
  /** Close the underlying pool. Always call this when done. */
  close: () => Promise<void>;
}

/**
 * Build a pg-backed proposal store from env, or null when the DB URL is absent
 * (local dev without the spine configured — callers then no-op gracefully).
 */
export function createCockpitProposalDb(env: NodeJS.ProcessEnv = process.env): ProposalDbHandle | null {
  const connectionString = env[COCKPIT_SPINE_DB_URL_ENV];
  if (!connectionString || connectionString.trim().length === 0) return null;

  // This is a server-side admin write path (the connection string itself is the
  // secret). Strict TLS chain verification is used whenever a Supabase CA is
  // configured (HARTOS_SUPABASE_CA / _CA_PATH); absent that we preserve the prior
  // relaxed behavior so existing deploys do not regress. Small pool — this is a
  // low-volume mirror, not a hot path.
  const { ssl, tlsMode } = buildSupabaseSsl(env);
  if (tlsMode === "relaxed") {
    console.warn(
      "[cockpit-proposal-db] TLS chain verification disabled (no HARTOS_SUPABASE_CA configured). " +
        "Set HARTOS_SUPABASE_CA or HARTOS_SUPABASE_CA_PATH to enable strict verification.",
    );
  }
  const pool = new Pool({ connectionString, max: 2, ssl });
  const db: Queryable = { query: (text, params) => pool.query(text, params) };
  return {
    store: new SupabaseProposalStore(db),
    tlsMode,
    close: () => pool.end(),
  };
}

/**
 * Backfill: mirror the local filesystem proposal queue into the Supabase spine
 * so existing proposals appear in the hosted cockpit. Returns counts, or null
 * when no spine DB is configured.
 */
export async function syncFilesystemProposalsToSupabase(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SyncResult | null> {
  const handle = createCockpitProposalDb(env);
  if (!handle) return null;
  try {
    const items = await listProposals(cwd);
    return await handle.store.upsertMany(items);
  } finally {
    await handle.close();
  }
}
