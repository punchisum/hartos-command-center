/**
 * scripts/agent-revoke-execution.ts
 *
 * Phase 17C §11 Q3 — explicitly revoke execution authorization (there is no auto-expiry).
 * Transition: approved_for_execution → simulated_approved (durable spec id is kept).
 *
 * Usage:
 *   npm run agent:revoke-execution -- --id=<proposal-id>
 *   npm run agent:revoke-execution -- --number=<n>
 */

import { revokeExecutionApproval, type ProposalRef } from "../src/cockpit/proposals/proposal-queue.js";

function parseRef(): ProposalRef {
  const id = process.argv.find((a) => a.startsWith("--id="))?.replace("--id=", "");
  const numArg = process.argv.find((a) => a.startsWith("--number="))?.replace("--number=", "");
  if (id) return { id };
  if (numArg) return { number: Number.parseInt(numArg, 10) };
  throw new Error("Provide --id=<proposal-id> or --number=<n>.");
}

const cwd = process.cwd();
const now = new Date().toISOString();
const item = await revokeExecutionApproval(cwd, parseRef(), now);

if (!item) {
  console.error("Proposal not found.");
  process.exit(1);
}
if (item.status === "simulated_approved") {
  console.log(`Execution authorization revoked: ${item.id} (now simulated_approved; spec id ${item.specId} retained).`);
} else {
  console.error(`Not revoked — status is "${item.status}" (requires approved_for_execution). See audit log.`);
  process.exit(1);
}
