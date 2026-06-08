/**
 * src/cockpit/threads/supabase-thread-db.ts
 *
 * Phase D — Node-ONLY pg adapter for the cockpit thread spine. Mirrors
 * supabase-proposal-db.ts: it is the ONLY thread module that imports the postgres
 * driver and is never reached from the hosted Worker, so pg never enters the
 * Worker bundle. Builds a SupabaseThreadStore over a pooled connection to
 * HARTOS_SUPABASE_DB_URL (the fitness project, elevated role) and offers a
 * filesystem → spine backfill of cockpit-threads/thread-*.json.
 */

import pg from "pg";
import path from "node:path";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { SupabaseThreadStore, type Queryable, type SyncResult } from "./supabase-thread-store.js";
import type { CockpitThread } from "../cockpit-types.js";

const { Pool } = pg;

/** The env var holding the elevated (RLS-bypassing) Postgres connection string. */
export const COCKPIT_SPINE_DB_URL_ENV = "HARTOS_SUPABASE_DB_URL";
export const DEFAULT_THREADS_DIR = "cockpit-threads";

export interface ThreadDbHandle {
  store: SupabaseThreadStore;
  /** Close the underlying pool. Always call this when done. */
  close: () => Promise<void>;
}

/** Build a pg-backed thread store from env, or null when the DB URL is absent. */
export function createCockpitThreadDb(env: NodeJS.ProcessEnv = process.env): ThreadDbHandle | null {
  const connectionString = env[COCKPIT_SPINE_DB_URL_ENV];
  if (!connectionString || connectionString.trim().length === 0) return null;
  // Server-side admin write path (the connection string itself is the secret).
  const pool = new Pool({ connectionString, max: 2, ssl: { rejectUnauthorized: false } });
  const db: Queryable = { query: (text, params) => pool.query(text, params) };
  return { store: new SupabaseThreadStore(db), close: () => pool.end() };
}

/** Read local cockpit-threads/thread-*.json into CockpitThread objects (skips junk). */
export async function loadLocalThreads(cwd: string): Promise<CockpitThread[]> {
  const dir = path.join(cwd, DEFAULT_THREADS_DIR);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.startsWith("thread-") && f.endsWith(".json"));
  const threads: CockpitThread[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(await readFile(path.join(dir, file), "utf8")) as CockpitThread;
      if (parsed && typeof parsed.threadId === "string" && Array.isArray(parsed.entries)) threads.push(parsed);
    } catch {
      // skip malformed thread file
    }
  }
  return threads;
}

/**
 * Backfill: mirror the local filesystem thread sidecars into the Supabase spine so
 * existing threads appear in the hosted cockpit. Returns counts, or null when no
 * spine DB is configured.
 */
export async function syncFilesystemThreadsToSupabase(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SyncResult | null> {
  const handle = createCockpitThreadDb(env);
  if (!handle) return null;
  try {
    const threads = await loadLocalThreads(cwd);
    return await handle.store.upsertMany(threads);
  } finally {
    await handle.close();
  }
}
