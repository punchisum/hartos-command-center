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
 * Env (load via `node --env-file-if-exists=.env.local`; values are NEVER printed):
 *   HARTOS_ASK_WRITE_URL          persist-cockpit-proposal function URL
 *   HARTOS_ASK_WRITE_TOKEN        shared capability token (Bearer) — same one as cockpit:ask
 *   ALLOW_EXEC_REFRESH_SYNC       "true" arms the one action (default-absent = OFF)
 *   HARTOS_EXECUTION_KILL_SWITCH  "on" overrides everything (global stop)
 *
 * HONEST LIMIT: the current executor TRUSTS the proposal status passed below — it does not
 * re-read the row from the DB. So the two keys for THIS canary are (1) possession of the
 * capability token and (2) ALLOW_EXEC_REFRESH_SYNC=true, both of which only the operator
 * sets. (Follow-up: have the gate verify the live row status server-side.)
 */

import { runRefreshSync, type RefreshSyncProposal } from "../src/execution/run-refresh-sync.js";
import { REFRESH_SYNC_FLAG } from "../src/execution/adapters/refresh-sync.js";
import { KILL_SWITCH_ENV } from "../src/execution/execution-adapter.js";

const env = process.env;
const execute = process.argv.includes("--execute");

// Fail fast + clearly if the endpoint isn't configured (report NAMES only, never values).
const missing = ["HARTOS_ASK_WRITE_URL", "HARTOS_ASK_WRITE_TOKEN"].filter((k) => !env[k] || !String(env[k]).trim());
if (missing.length) {
  console.error(`Cannot reach the Edge Function — missing env: ${missing.join(", ")}.`);
  console.error("Load it with:  node --env-file-if-exists=.env.local dist/scripts/run-canary-refresh-sync.js");
  console.error("URL = the persist-cockpit-proposal function URL; TOKEN = the same capability token as `npm run cockpit:ask`.");
  process.exit(1);
}

let endpointHost = "(unparseable URL)";
try { endpointHost = new URL(String(env.HARTOS_ASK_WRITE_URL)).host; } catch { /* keep placeholder */ }

const flag = env[REFRESH_SYNC_FLAG];
const killOn = (env[KILL_SWITCH_ENV] ?? "").trim().toLowerCase() === "on";

console.log("HartOS Phase 3 canary — refresh-sync");
console.log(`  endpoint:                     ${endpointHost}`);
console.log(`  mode:                         ${execute ? "EXECUTE (writes IF the gate allows)" : "dry-run (count only, no write)"}`);
console.log(`  ${REFRESH_SYNC_FLAG} = ${flag === "true" ? "true (ARMED)" : flag ? `${JSON.stringify(flag)} (not "true" → OFF)` : "unset (OFF)"}`);
console.log(`  ${KILL_SWITCH_ENV} = ${killOn ? "on (BLOCKS ALL execution)" : "off"}`);
console.log("");

// The authorization envelope (see HONEST LIMIT above — status is asserted, not DB-verified).
const proposal: RefreshSyncProposal = { id: "canary-refresh-sync", status: "approved_for_execution", expiresAt: null };

const result = await runRefreshSync(proposal, env, { dryRun: !execute });

if (!execute) {
  console.log(`Dry-run: ${result.outcome?.summary ?? "(no outcome returned)"}`);
  console.log(`To fire for real:  set ${REFRESH_SYNC_FLAG}=true, ensure the kill-switch is off, then re-run with --execute.`);
  process.exit(0);
}

if (!result.precondition.allowed) {
  console.log("REFUSED by the fail-closed gate (correct if you have not armed the flag):");
  for (const d of result.precondition.denials) console.log(`  - ${d}`);
  console.log(`\nTo fire:  set ${REFRESH_SYNC_FLAG}=true (kill-switch off), then re-run with --execute.`);
  process.exit(2);
}

if (result.executed && result.outcome) {
  console.log(`EXECUTED: ${result.outcome.summary}`);
  console.log(`  before: ${JSON.stringify(result.outcome.before)}   after: ${JSON.stringify(result.outcome.after)}`);
  console.log("A durable audit row was written by the Edge Function (proposal_id=refresh-sync, event=refresh_sync_executed).");
  console.log("Idempotent: an immediate re-run should expire 0 and leave the queue unchanged.");
  process.exit(0);
}

console.log("Gate allowed but no execution outcome was returned — check the Edge Function logs (get_logs).");
process.exit(3);
