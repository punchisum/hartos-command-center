/**
 * src/execution/run-refresh-sync-db.ts — Phase 3 executor store (elevated Node DB credential).
 *
 * The refresh-sync action's LIVE store over a direct pg connection to HARTOS_SUPABASE_DB_URL —
 * the executor path the adapter's docstring anticipates ("the LIVE store uses the elevated Node
 * DB credential — never the read-only Worker"). It mirrors the Edge Function's refresh_sync op
 * EXACTLY: count / conditionally-expire past-due draft|pending rows in cockpit_proposals + one
 * append-only audit row. pg is isolated here (Node-only); it never enters the Worker bundle, and
 * the Phase 2.5 fail-closed gate runs BEFORE any of this is reached.
 */

import pg from "pg";
import type { RefreshSyncStore } from "./adapters/refresh-sync.js";

const { Pool } = pg;

/** The env var holding the elevated (RLS-bypassing) Postgres connection string. */
export const EXECUTOR_DB_URL_ENV = "HARTOS_SUPABASE_DB_URL";

/** The live lifecycle status + expiry of a proposal, as read straight from the DB. */
export interface LiveProposalStatus {
  status: string;
  expiresAt: string | null;
}

/**
 * A refresh-sync store that ALSO exposes a server-side live-status read — re-reading the
 * target proposal's current status + expiry from the SAME pg pool, so the executor can verify
 * the row before writing (read-before-write, plan §1/§10) instead of trusting a caller-supplied
 * status. Additive over `RefreshSyncStore`; the live store keeps all existing behavior.
 */
export interface VerifyingRefreshSyncStore extends RefreshSyncStore {
  /** Re-read the live status + expiry for `proposalId`, or null when the row does not exist. */
  getLiveProposalStatus(proposalId: string): Promise<LiveProposalStatus | null>;
}

/** Past-due, still-pending proposals — the only rows this action may touch. `$1` is `now`. */
const STALE_FILTER = "status in ('draft','pending_approval') and expires_at is not null and expires_at < $1";

/** Minimal pg surface — lets tests inject a fake query without a live connection. */
export interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

export type TlsMode = "strict" | "relaxed";

export interface RefreshSyncDbHandle {
  store: VerifyingRefreshSyncStore;
  /** "strict" = chain-verified; "relaxed" = fell back because the pooler cert wouldn't chain. */
  tlsMode: TlsMode;
  /** Close the underlying pool. Always call when done. */
  close: () => Promise<void>;
}

/** A TLS chain failure specifically (so we relax ONLY for that, never for real errors). */
function isCertChainError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const code = String((e as { code?: unknown })?.code ?? "");
  return /self[- ]signed|unable to (get|verify)|certificate|cert chain|altnames/i.test(msg) ||
    /SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|^CERT_/i.test(code);
}

/** Open a pool and force a real connection NOW (so TLS is validated up front, not lazily). */
async function openPool(connectionString: string, strict: boolean): Promise<InstanceType<typeof Pool>> {
  const pool = new Pool({ connectionString, max: 2, ssl: { rejectUnauthorized: strict } });
  try {
    await pool.query("select 1");
    return pool;
  } catch (e) {
    await pool.end().catch(() => {});
    throw e;
  }
}

/** Build the refresh-sync store over any Queryable (the seam tests exercise). */
export function makeRefreshSyncStore(db: Queryable): VerifyingRefreshSyncStore {
  return {
    async getLiveProposalStatus(proposalId: string): Promise<LiveProposalStatus | null> {
      // Read-before-write: re-read the live row over the SAME pool (no new connection). The
      // executor compares this against EXECUTABLE_FROM before any conditional write.
      const r = await db.query(
        "select status, expires_at from public.cockpit_proposals where id = $1",
        [proposalId],
      );
      const row = r.rows[0];
      if (!row) return null;
      const expiresAtRaw = row.expires_at;
      return {
        status: String(row.status ?? ""),
        expiresAt:
          expiresAtRaw == null
            ? null
            : expiresAtRaw instanceof Date
              ? expiresAtRaw.toISOString()
              : String(expiresAtRaw),
      };
    },
    async countStaleProposals(now: string): Promise<number> {
      const r = await db.query(`select count(*)::int as n from public.cockpit_proposals where ${STALE_FILTER}`, [now]);
      return Number(r.rows[0]?.n ?? 0);
    },
    async expireStaleProposals(now: string): Promise<number> {
      const r = await db.query(
        `update public.cockpit_proposals set status='expired', updated_at=$1 where ${STALE_FILTER} returning id`,
        [now],
      );
      return r.rowCount ?? 0;
    },
    async stampSync(proposalId: string, now: string, expired: number): Promise<void> {
      // Append-only audit — the durable proof this execution ran (mirrors the Edge Function op).
      await db.query(
        "insert into public.cockpit_proposal_audit (proposal_id, event, to_status, at) values ($1, $2, $3, $4)",
        [proposalId, "refresh_sync_executed", `expired:${expired}`, now],
      );
    },
  };
}

/**
 * Build a pooled, pg-backed refresh-sync store from env, or null when the DB URL is absent.
 * Connects with STRICT TLS (chain verification on) and only falls back to relaxed verification
 * if the connection fails specifically because the pooler cert won't chain — surfacing `tlsMode`
 * so the caller can warn. The connection string itself is the secret; it's never logged.
 * (Permanent fix for "relaxed": supply the Supabase CA so strict verification succeeds.)
 */
export async function createRefreshSyncDb(env: NodeJS.ProcessEnv = process.env): Promise<RefreshSyncDbHandle | null> {
  const connectionString = env[EXECUTOR_DB_URL_ENV];
  if (!connectionString || connectionString.trim().length === 0) return null;

  let pool: InstanceType<typeof Pool>;
  let tlsMode: TlsMode = "strict";
  try {
    pool = await openPool(connectionString, true); // strict first
  } catch (e) {
    if (!isCertChainError(e)) throw e; // a real (non-TLS) failure must surface, not be masked
    pool = await openPool(connectionString, false); // relax ONLY for a genuine cert-chain failure
    tlsMode = "relaxed";
  }
  const db: Queryable = { query: (text, params) => pool.query(text, params) };
  return { store: makeRefreshSyncStore(db), tlsMode, close: () => pool.end() };
}
