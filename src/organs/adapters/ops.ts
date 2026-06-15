/**
 * src/organs/adapters/ops.ts — the Ops organ adapter.
 *
 * Ops is a READ-ONLY PROJECTION of the SEPARATE GECAN ops system (Supabase project
 * tbdkveyixqjksamcdemr) — NOT the cockpit DB. HartOS only reads it; it NEVER mutates,
 * NEVER calls ClickUp, NEVER executes. The clean daemon-side read path already exists:
 * SupabaseReadClient over the REST/PostgREST boundary configured by the cockpit env
 * (HARTOS_OPS_SUPABASE_URL + HARTOS_OPS_SUPABASE_READONLY_KEY). That client is strictly
 * read-only by construction (no insert/update/delete/upsert, no mutation RPC).
 *
 * This adapter probes GECAN `sync_runs` recency — "when did the ops system last sync?" —
 * and reports it as honest evidence. armingFlag is null because a read-only projection
 * needs no arming gate (same posture as the cockpit organ).
 *
 * Doctrine: status is DERIVED from evidence; NEVER fabricate ok:true.
 *   - No read-model env wired daemon-side  => honest PARTIAL (ok:false, the mandated
 *     "GECAN read-model not wired daemon-side" summary). We do NOT invent a pg path.
 *   - Env present + a recent sync row reads back => ok:true; outputRef = latest sync_run id;
 *     summary = `latest GECAN sync @ <ts>`.
 *   - Env present but no rows / read failure  => honest ok:false (no fabrication).
 */
import type { OrganAdapter } from "../organ-supervisor.js";
import type { OrganRunResult } from "../organ-contract.js";
import { SupabaseReadClient } from "../../read-models/supabase-read-client.js";

const URL_ENV = "HARTOS_OPS_SUPABASE_URL";
const KEY_ENV = "HARTOS_OPS_SUPABASE_READONLY_KEY";
const SYNC_RUNS = "sync_runs";

/** Trim the honest summary to the contract's <300-char budget. */
function cap(s: string): string {
  return s.length > 299 ? s.slice(0, 299) : s;
}

export const opsOrgan: OrganAdapter = {
  organId: "ops",
  armingFlag: null,
  async run(env: NodeJS.ProcessEnv, _now: string): Promise<OrganRunResult> {
    const url = (env[URL_ENV] ?? "").trim();
    const key = (env[KEY_ENV] ?? "").trim();

    // No daemon-side read path available => honest PARTIAL. Do NOT invent one.
    if (!url || !key) {
      return { ok: false, outputRef: null, summary: "ops projection: GECAN read-model not wired daemon-side" };
    }

    try {
      // Strictly read-only PostgREST client; sync_runs must be allowlisted to be read.
      const client = new SupabaseReadClient({ url, key, allowedTables: [SYNC_RUNS], allowedRpcs: [] });
      const rows = await client.select(SYNC_RUNS, { limit: 1, order: "created_at" });
      const row = (rows[0] ?? null) as Record<string, unknown> | null;

      if (!row || row["id"] === undefined || row["id"] === null) {
        return { ok: false, outputRef: null, summary: "ops projection: GECAN sync_runs reachable but empty" };
      }

      const id = String(row["id"]);
      const ts = String(row["created_at"] ?? row["completed_at"] ?? row["started_at"] ?? "unknown");
      const outcome = typeof row["outcome"] === "string" ? (row["outcome"] as string) : undefined;
      return {
        ok: true,
        outputRef: id,
        summary: cap(`latest GECAN sync @ ${ts}`),
        detail: { id, ts, ...(outcome ? { outcome } : {}) },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, outputRef: null, summary: cap(`ops projection: GECAN read failed: ${msg}`) };
    }
  },
};
