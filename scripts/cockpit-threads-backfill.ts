/**
 * scripts/cockpit-threads-backfill.ts
 *
 * Phase D — one-shot backfill: mirror the local filesystem cockpit threads
 * (cockpit-threads/thread-*.json) into the Supabase spine (the fitness project's
 * cockpit_threads table) so existing threads appear in the hosted, read-only
 * cockpit.
 *
 * Requires HARTOS_SUPABASE_DB_URL (elevated DB role). Run after the migration:
 *   npm run cockpit:threads:backfill
 *
 * Writes ONLY threads (secret-checked). No execution, no other mutation. Safe to
 * re-run (idempotent upsert by thread_id).
 */

import { syncFilesystemThreadsToSupabase } from "../src/cockpit/threads/supabase-thread-db.js";

async function main(): Promise<void> {
  const cwd = process.cwd();
  const result = await syncFilesystemThreadsToSupabase(cwd);
  if (!result) {
    console.log("[cockpit-threads-backfill] No spine configured (HARTOS_SUPABASE_DB_URL absent). Nothing written.");
    return;
  }
  const skipped = result.skipped.length ? ` Skipped ids: ${result.skipped.join(", ")}` : "";
  console.log(`[cockpit-threads-backfill] Upserted ${result.upserted}, failed ${result.failed}.${skipped}`);
}

main().catch((err) => {
  console.error("[cockpit-threads-backfill] Failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
