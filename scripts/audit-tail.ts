/**
 * scripts/audit-tail.ts — read-only CLI: tail the append-only cockpit proposal audit log.
 *
 * Opens a pg pool against HARTOS_SUPABASE_DB_URL with STRICT TLS by default (supply the
 * Supabase CA via HARTOS_SUPABASE_CA / HARTOS_SUPABASE_CA_PATH; otherwise verification is
 * relaxed — see buildSupabaseSsl), reads the newest audit rows, prints them aligned, and
 * closes the pool. SELECT only — the table is insert-only by design, so this can never
 * mutate it. The connection only actually opens when run live; the import + structure is
 * what ships.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/audit-tail.js [limit]
 *
 * `limit` (optional, default 20) — how many of the newest rows to show.
 */

import pg from "pg";
import { fetchAuditTail, formatAuditTail } from "../src/execution/audit-tail.js";
import { buildSupabaseSsl } from "../src/lib/supabase-tls.js";

const { Pool } = pg;

const DB_URL_ENV = "HARTOS_SUPABASE_DB_URL";

async function main(): Promise<void> {
  const connectionString = process.env[DB_URL_ENV];
  if (!connectionString || connectionString.trim().length === 0) {
    console.error(`[audit-tail] ${DB_URL_ENV} is not set (report the NAME only, never the value).`);
    console.error("[audit-tail] Load .env.local with:  node --env-file-if-exists=.env.local dist/scripts/audit-tail.js");
    process.exitCode = 1;
    return;
  }

  const limitArg = process.argv[2];
  const parsed = limitArg ? Number(limitArg) : 20;
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 20;

  const { ssl, tlsMode } = buildSupabaseSsl(process.env);
  console.log(`[audit-tail] tls: ${tlsMode}${tlsMode === "relaxed" ? " (no CA supplied — verification relaxed)" : " (chain-verified)"}`);

  const pool = new Pool({ connectionString, max: 1, ssl });
  try {
    const rows = await fetchAuditTail({ query: (text, params) => pool.query(text, params) }, limit);
    console.log(`[audit-tail] newest ${rows.length} of cockpit_proposal_audit (limit ${limit}):\n`);
    console.log(formatAuditTail(rows));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[audit-tail] Failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
