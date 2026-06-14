/**
 * src/execution/run-reject-drafts-db.ts — plan §14 executor store (elevated Node DB credential).
 *
 * The reject-drafts action's LIVE store over a direct pg connection to HARTOS_SUPABASE_DB_URL —
 * the executor path the adapter's docstring anticipates ("the LIVE store uses the elevated Node
 * DB credential — never the read-only Worker"). It counts / conditionally-rejects every `draft`
 * row in cockpit_proposals + writes one append-only audit row. The scope is narrow (Commander-
 * decided): `status='draft'` only — never `pending_approval` or any further state. pg is isolated
 * here (Node-only); it never enters the Worker bundle, and the Phase 2.5 fail-closed gate runs
 * BEFORE any of this is reached.
 */

import pg from "pg";
import type { RejectDraftsStore } from "./adapters/reject-drafts.js";

const { Pool } = pg;

/** The env var holding the elevated (RLS-bypassing) Postgres connection string. */
export const EXECUTOR_DB_URL_ENV = "HARTOS_SUPABASE_DB_URL";

/** Draft proposals — the only rows this action may touch (Commander-decided narrow scope). */
const DRAFT_FILTER = "status='draft'";

/** Minimal pg surface — lets tests inject a fake query without a live connection. */
export interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

export type TlsMode = "strict" | "relaxed";

export interface RejectDraftsDbHandle {
  store: RejectDraftsStore;
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

/** Build the reject-drafts store over any Queryable (the seam tests exercise). */
export function makeRejectDraftsStore(db: Queryable): RejectDraftsStore {
  return {
    async countRejectableDrafts(_now: string): Promise<number> {
      // The filter is a literal (status='draft'), so this SQL has NO $N placeholders — it must
      // be sent with zero bind params. Passing `now` here made Postgres reject the Bind every
      // reconcile cycle ("bind supplies 1 parameters, but … requires 0"); `_now` is unused.
      const r = await db.query(`select count(*)::int as n from public.cockpit_proposals where ${DRAFT_FILTER}`);
      return Number(r.rows[0]?.n ?? 0);
    },
    async rejectDraftProposals(now: string): Promise<number> {
      const r = await db.query(
        `update public.cockpit_proposals set status='rejected', updated_at=$1 where ${DRAFT_FILTER} returning id`,
        [now],
      );
      return r.rowCount ?? 0;
    },
    async stampSync(proposalId: string, now: string, rejected: number): Promise<void> {
      // Append-only audit — the durable proof this execution ran. The transition is draft→rejected.
      await db.query(
        "insert into public.cockpit_proposal_audit (proposal_id, event, to_status, at) values ($1, $2, $3, $4)",
        [proposalId, "reject_drafts_executed", "rejected", now],
      );
    },
  };
}

/**
 * Build a pooled, pg-backed reject-drafts store from env, or null when the DB URL is absent.
 * Connects with STRICT TLS (chain verification on) and only falls back to relaxed verification
 * if the connection fails specifically because the pooler cert won't chain — surfacing `tlsMode`
 * so the caller can warn. The connection string itself is the secret; it's never logged.
 * (Permanent fix for "relaxed": supply the Supabase CA so strict verification succeeds.)
 */
export async function createRejectDraftsDb(env: NodeJS.ProcessEnv = process.env): Promise<RejectDraftsDbHandle | null> {
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
  return { store: makeRejectDraftsStore(db), tlsMode, close: () => pool.end() };
}
