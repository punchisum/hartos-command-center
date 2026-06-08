/**
 * scripts/cockpit-proposals-backfill.ts
 *
 * Phase D — one-shot backfill: mirror the local filesystem proposal queue into
 * the Supabase spine (the fitness project's cockpit_proposals table) so existing
 * proposals appear in the hosted, read-only cockpit.
 *
 * Requires HARTOS_SUPABASE_DB_URL (elevated DB role). Run after the migration:
 *   npm run cockpit:proposals:backfill
 *
 * Writes ONLY proposals (dry-run drafts, secret-checked). No execution, no other
 * mutation. Safe to re-run (idempotent upsert by id).
 */

import { syncFilesystemProposalsToSupabase } from "../src/cockpit/proposals/supabase-proposal-db.js";

async function main(): Promise<void> {
  const cwd = process.cwd();
  const result = await syncFilesystemProposalsToSupabase(cwd);
  if (!result) {
    console.log("[cockpit-proposals-backfill] No spine configured (HARTOS_SUPABASE_DB_URL absent). Nothing written.");
    return;
  }
  const skipped = result.skipped.length ? ` Skipped ids: ${result.skipped.join(", ")}` : "";
  console.log(`[cockpit-proposals-backfill] Upserted ${result.upserted}, failed ${result.failed}.${skipped}`);
}

main().catch((err) => {
  console.error("[cockpit-proposals-backfill] Failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
