/**
 * src/execution/run-mark-reviewed-db.ts — plan §14 executor store (elevated Node DB credential).
 *
 * The mark-reviewed action's LIVE store over a direct pg connection to HARTOS_SUPABASE_DB_URL —
 * the executor path the adapter's docstring anticipates ("the LIVE store uses the elevated Node DB
 * credential — never the read-only Worker"). It mirrors the archive-rejected executor store
 * EXACTLY: count / read-before-write snapshot / conditionally-mark `domain='ops'` rows in
 * cockpit_proposals + one append-only audit row. The differences are the target filter
 * (`domain='ops'` not-yet-reviewed) + the write marker: "reviewed" is a REVERSIBLE jsonb marker
 * (`payload.reviewed=true`) merged onto the existing `payload` jsonb column — NOT a new lifecycle
 * status (no migration, no enum change) — plus the T2 read-before-write `readReviewableOps`
 * snapshot. pg is isolated here (Node-only); it never enters the Worker bundle, and the Phase 2.5
 * fail-closed gate runs BEFORE any of this is reached.
 */

import pg from "pg";
import type { MarkReviewedStore, ReviewableSnapshot } from "./adapters/mark-reviewed.js";

const { Pool } = pg;

/** The env var holding the elevated (RLS-bypassing) Postgres connection string. */
export const EXECUTOR_DB_URL_ENV = "HARTOS_SUPABASE_DB_URL";

/**
 * `domain='ops'` rows not yet carrying the reversible reviewed marker — the only rows this
 * action may touch. `(payload->>'reviewed') IS DISTINCT FROM 'true'` keeps it idempotent: once a
 * row is marked it is excluded, so a re-run matches nothing. (No `$1` param — `now` rides the
 * UPDATE's `updated_at` / the count + snapshot are param-free.)
 */
const REVIEWABLE_FILTER = "domain='ops' and (payload->>'reviewed') is distinct from 'true'";

/** Minimal pg surface — lets tests inject a fake query without a live connection. */
export interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

export type TlsMode = "strict" | "relaxed";

export interface MarkReviewedDbHandle {
  store: MarkReviewedStore;
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

/** Build the mark-reviewed store over any Queryable (the seam tests exercise). */
export function makeMarkReviewedStore(db: Queryable): MarkReviewedStore {
  return {
    async countReviewableOps(_now: string): Promise<number> {
      const r = await db.query(`select count(*)::int as n from public.cockpit_proposals where ${REVIEWABLE_FILTER}`);
      return Number(r.rows[0]?.n ?? 0);
    },
    async readReviewableOps(_now: string): Promise<ReviewableSnapshot[]> {
      // T2 read-before-write: snapshot the current id/status/payload of the rows we are about to
      // touch, BEFORE any write. Read-only — no marker is set here.
      const r = await db.query(`select id, status, payload from public.cockpit_proposals where ${REVIEWABLE_FILTER}`);
      return r.rows.map((row) => ({
        id: String(row.id),
        status: row.status === null || row.status === undefined ? null : String(row.status),
        payload: (row.payload ?? null) as Record<string, unknown> | null,
      }));
    },
    async markReviewedProposals(now: string): Promise<number> {
      // Reversible jsonb merge: COALESCE guards a null payload, `||` shallow-merges the marker so
      // existing payload keys survive. Conditional on the reviewable filter ⇒ idempotent re-runs.
      const r = await db.query(
        `update public.cockpit_proposals set payload = coalesce(payload,'{}'::jsonb) || '{"reviewed":true}'::jsonb, updated_at=$1 where ${REVIEWABLE_FILTER} returning id`,
        [now],
      );
      return r.rowCount ?? 0;
    },
    async stampSync(proposalId: string, now: string, reviewed: number): Promise<void> {
      // Append-only audit — the durable proof this execution ran (mirrors the archive-rejected op).
      await db.query(
        "insert into public.cockpit_proposal_audit (proposal_id, event, to_status, at) values ($1, $2, $3, $4)",
        [proposalId, "mark_reviewed_executed", `reviewed:${reviewed}`, now],
      );
    },
  };
}

/**
 * Build a pooled, pg-backed mark-reviewed store from env, or null when the DB URL is absent.
 * Connects with STRICT TLS (chain verification on) and only falls back to relaxed verification
 * if the connection fails specifically because the pooler cert won't chain — surfacing `tlsMode`
 * so the caller can warn. The connection string itself is the secret; it's never logged.
 * (Permanent fix for "relaxed": supply the Supabase CA so strict verification succeeds.)
 */
export async function createMarkReviewedDb(env: NodeJS.ProcessEnv = process.env): Promise<MarkReviewedDbHandle | null> {
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
  return { store: makeMarkReviewedStore(db), tlsMode, close: () => pool.end() };
}
