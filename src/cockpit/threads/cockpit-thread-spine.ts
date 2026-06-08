/**
 * src/cockpit/threads/cockpit-thread-spine.ts
 *
 * Phase D — SHARED, PURE thread-spine helpers. Zero I/O, zero secrets, no
 * Node-only or browser-only deps, so BOTH sides import it safely:
 *   • the Node write store (supabase-thread-store.ts), and
 *   • the hosted Worker reader (cloudflare-live-read-models.ts).
 *
 * Mirrors cockpit-proposal-spine.ts: the read RPC name, the row shape that RPC
 * returns, the pure row → summary mapping the cockpit shows, and the pure
 * CockpitThread → write-row mapping the Node store persists.
 */

import type { CockpitThread } from "../cockpit-types.js";

/** The single anon-callable, read-only RPC that exposes cockpit threads. */
export const COCKPIT_THREADS_RPC = "get_cockpit_threads";

/** The scalar columns the read RPC returns (snake_case, matching the SQL). */
export interface CockpitThreadRow {
  thread_id: string;
  created_at: string;
  updated_at: string;
  entry_count: number;
  latest_request: string | null;
  latest_intent: string | null;
  latest_summary: string | null;
}

/** The render-ready thread summary the hosted cockpit consumes. */
export interface CockpitThreadSummary {
  threadId: string;
  createdAt: string;
  updatedAt: string;
  entryCount: number;
  latestRequest: string;
  latestIntent: string;
  latestSummary: string;
}

/** The columns the Node store / backfill upserts: read row + jsonb payload. */
export interface CockpitThreadWriteRow {
  thread_id: string;
  created_at: string;
  updated_at: string;
  entry_count: number;
  latest_request: string | null;
  latest_intent: string | null;
  latest_summary: string | null;
  payload: Record<string, unknown>;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Coerce the RPC's `unknown` JSON body into well-formed rows (skips junk). */
export function coerceCockpitThreadRows(body: unknown): CockpitThreadRow[] {
  if (!Array.isArray(body)) return [];
  const rows: CockpitThreadRow[] = [];
  for (const r of body) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.thread_id !== "string" || o.thread_id.length === 0) continue;
    rows.push({
      thread_id: o.thread_id,
      created_at: typeof o.created_at === "string" ? o.created_at : "",
      updated_at: typeof o.updated_at === "string" ? o.updated_at : "",
      entry_count: num(o.entry_count),
      latest_request: typeof o.latest_request === "string" ? o.latest_request : null,
      latest_intent: typeof o.latest_intent === "string" ? o.latest_intent : null,
      latest_summary: typeof o.latest_summary === "string" ? o.latest_summary : null,
    });
  }
  return rows;
}

/** Map one RPC row to the summary the cockpit shows (honest, non-fabricated defaults). */
export function mapRowToThreadSummary(row: CockpitThreadRow): CockpitThreadSummary {
  return {
    threadId: row.thread_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    entryCount: row.entry_count,
    latestRequest: row.latest_request ?? "",
    latestIntent: row.latest_intent ?? "",
    latestSummary: row.latest_summary ?? "",
  };
}

/**
 * Pure CockpitThread → spine write-row mapping. The scalar summary fields are
 * derived from the newest entry; the full thread is round-tripped in `payload`.
 */
export function threadToSpineRow(thread: CockpitThread): CockpitThreadWriteRow {
  const last = thread.entries[thread.entries.length - 1];
  return {
    thread_id: thread.threadId,
    created_at: thread.createdAt,
    updated_at: thread.updatedAt,
    entry_count: thread.entries.length,
    latest_request: last?.request ?? null,
    latest_intent: last?.response?.intent ?? null,
    latest_summary: last?.response?.intentSummary ?? last?.response?.intentTitle ?? null,
    payload: thread as unknown as Record<string, unknown>,
  };
}
