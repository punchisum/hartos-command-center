/**
 * scripts/run-canary-refresh-sync.ts — Phase 3 canary: the human-fired first execution.
 *
 * Drives the ONE allowlisted, reversible action (refresh-sync) through the SAME fail-closed
 * gate + capability-token Edge Function the design mandates. The Worker/Edge Function never
 * execute; only this Node host does, and only through `runRefreshSync` → `runExecutionAdapter`.
 *
 *   • DRY-RUN (default)  — counts past-due draft|pending proposals via the Edge Function.
 *                          No write. Bypasses the gate. A safe connectivity + scope check.
 *   • --execute          — attempts the real run. The gate ALLOWS it only when
 *                          ALLOW_EXEC_REFRESH_SYNC === "true" AND the kill-switch is off AND a
 *                          capability token is present. With the flag OFF, --execute shows the
 *                          refusal (proving fail-closed) and writes nothing.
 *
 * Effect ceiling on execute: sets already-past-due draft|pending rows in HartOS's OWN
 * cockpit_proposals to "expired" + writes one durable audit row. Reversible + idempotent
 * (a re-run expires 0). Touches no external system.
 *
 * Transport (pick ONE; the DB path is preferred + needs no new secret):
 *   HARTOS_SUPABASE_DB_URL        elevated pg URL — the executor store the adapter was built for
 *   HARTOS_ASK_WRITE_URL + _TOKEN persist-cockpit-proposal function URL + capability token
 *
 * Arming (load via `node --env-file-if-exists=.env.local`; values are NEVER printed):
 *   ALLOW_EXEC_REFRESH_SYNC       "true" arms the one action (default-absent = OFF)
 *   HARTOS_EXECUTION_KILL_SWITCH  "on" overrides everything (global stop)
 *
 * LIVE STATUS VERIFICATION (Level-0 hardening): the executor no longer TRUSTS a caller-
 * supplied status. Before any write, it re-reads the target proposal row server-side and
 * refuses unless the LIVE status is `approved_for_execution`. This canary therefore reads the
 * live row first and passes the real status through; if the row is absent or not approved
 * (the usual case for the synthetic canary id), the run is refused by construction — proving
 * the read-before-write floor — independent of the allowlist flag.
 */

import { runRefreshSync, liveRefreshSyncStore, type RefreshSyncProposal } from "../src/execution/run-refresh-sync.js";
import { createRefreshSyncDb, EXECUTOR_DB_URL_ENV, type VerifyingRefreshSyncStore } from "../src/execution/run-refresh-sync-db.js";
import { REFRESH_SYNC_FLAG, type RefreshSyncStore } from "../src/execution/adapters/refresh-sync.js";
import { KILL_SWITCH_ENV } from "../src/execution/execution-adapter.js";
import { EXECUTABLE_FROM } from "../src/doctrine/execution-gate.js";

const env = process.env;
const execute = process.argv.includes("--execute");

// Two transports, both Node-only + both behind the SAME gate. Prefer the elevated DB
// credential (the executor path the adapter was designed for); fall back to the Edge
// Function capability token. The store is the only thing that differs.
const hasDb = Boolean(env[EXECUTOR_DB_URL_ENV]?.trim());
const hasEdge = Boolean(env.HARTOS_ASK_WRITE_URL?.trim() && env.HARTOS_ASK_WRITE_TOKEN?.trim());
if (!hasDb && !hasEdge) {
  console.error("No executor credential found. Set ONE of (report NAMES only, never values):");
  console.error(`  • ${EXECUTOR_DB_URL_ENV}  (elevated pg URL — preferred; you already have this)`);
  console.error("  • HARTOS_ASK_WRITE_URL + HARTOS_ASK_WRITE_TOKEN  (Edge Function capability token)");
  console.error("Load .env.local with:  node --env-file-if-exists=.env.local dist/scripts/run-canary-refresh-sync.js");
  process.exit(1);
}

const transport: "db" | "edge" = hasDb ? "db" : "edge";
const flag = env[REFRESH_SYNC_FLAG];
const killOn = (env[KILL_SWITCH_ENV] ?? "").trim().toLowerCase() === "on";

console.log("HartOS Phase 3 canary — refresh-sync");
console.log(`  transport:                    ${transport === "db" ? `elevated DB (${EXECUTOR_DB_URL_ENV})` : "Edge Function capability token"}`);
console.log(`  mode:                         ${execute ? "EXECUTE (writes IF the gate allows)" : "dry-run (count only, no write)"}`);
console.log(`  ${REFRESH_SYNC_FLAG} = ${flag === "true" ? "true (ARMED)" : flag ? `${JSON.stringify(flag)} (not "true" → OFF)` : "unset (OFF)"}`);
console.log(`  ${KILL_SWITCH_ENV} = ${killOn ? "on (BLOCKS ALL execution)" : "off"}`);

// Open the executor transport. The DB path validates TLS up front (strict; relax only on a
// genuine cert-chain failure, and say so).
let dbHandle: Awaited<ReturnType<typeof createRefreshSyncDb>> = null;
if (transport === "db") {
  try {
    dbHandle = await createRefreshSyncDb(env);
  } catch (e) {
    console.error(`\nCould not connect via ${EXECUTOR_DB_URL_ENV}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  if (dbHandle) {
    console.log(`  tls:                          ${dbHandle.tlsMode === "relaxed"
      ? "relaxed  ⚠ pooler cert did not chain — verification relaxed for THIS run (supply the Supabase CA to fix)"
      : "strict (chain-verified)"}`);
  }
}
const store: RefreshSyncStore | undefined = dbHandle?.store;
console.log("");

// The proposal id this canary targets. There is normally NO such row, which is exactly why
// live verification refuses it — proving read-before-write.
const PROPOSAL_ID = "canary-refresh-sync";

// LIVE STATUS VERIFICATION (real run only): re-read the row server-side instead of asserting a
// status. Use the DB store when present (preferred), else the capability-token Edge store. The
// read never crashes the canary — a failure is reported and the proposal falls back to a
// "not approved" status so the run is refused by construction. Dry-run skips this (it never
// writes and ignores status), keeping the default path a pure connectivity check.
const verifyStore: VerifyingRefreshSyncStore | undefined = dbHandle?.store ?? (transport === "edge" ? liveRefreshSyncStore(env) : undefined);
let liveStatus: string | null = null;
let liveExpiresAt: string | null = null;
if (execute && verifyStore) {
  try {
    const live = await verifyStore.getLiveProposalStatus(PROPOSAL_ID);
    if (live) {
      liveStatus = live.status;
      liveExpiresAt = live.expiresAt;
    }
  } catch (e) {
    console.log(`  live-status read failed (will refuse): ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(`  live status (${PROPOSAL_ID}):  ${liveStatus ?? "(no such row — will refuse)"} (must equal "${EXECUTABLE_FROM}" to execute)`);
}

// Pass the REAL live status through (never a hardcoded assertion). If the row is absent, send a
// non-executable status so the executor's live-status check refuses by construction.
const proposal: RefreshSyncProposal = {
  id: PROPOSAL_ID,
  status: (liveStatus ?? "draft") as RefreshSyncProposal["status"],
  expiresAt: liveExpiresAt,
};

let result;
try {
  result = await runRefreshSync(proposal, env, { dryRun: !execute, store, hasCapabilityToken: transport === "db" ? true : undefined });
} finally {
  if (dbHandle) await dbHandle.close();
}

if (!execute) {
  console.log(`Dry-run: ${result.outcome?.summary ?? "(no outcome returned)"}`);
  console.log(`To fire for real:  set ${REFRESH_SYNC_FLAG}=true, ensure the kill-switch is off, then re-run with --execute.`);
  process.exit(0);
}

if (!result.precondition.allowed) {
  console.log("REFUSED by the fail-closed gate (correct if the flag is unarmed OR the live row is not approved_for_execution):");
  for (const d of result.precondition.denials) console.log(`  - ${d}`);
  console.log(`\nTo fire:  the live row must be ${EXECUTABLE_FROM}, ${REFRESH_SYNC_FLAG}=true (kill-switch off), then re-run with --execute.`);
  process.exit(2);
}

if (result.executed && result.outcome) {
  console.log(`EXECUTED: ${result.outcome.summary}`);
  console.log(`  before: ${JSON.stringify(result.outcome.before)}   after: ${JSON.stringify(result.outcome.after)}`);
  console.log(
    `A durable, append-only audit row was written by ${transport === "db" ? "the executor (direct insert)" : "the Edge Function"} ` +
      `(proposal_id=${proposal.id}, event=refresh_sync_executed).`,
  );
  console.log("Idempotent: an immediate re-run should expire 0 and leave the queue unchanged.");
  process.exit(0);
}

console.log("Gate allowed but no execution outcome was returned — check the Edge Function logs (get_logs).");
process.exit(3);
