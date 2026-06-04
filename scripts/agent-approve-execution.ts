/**
 * scripts/agent-approve-execution.ts
 *
 * Phase 17C Key 1 — authorize the Node executor to act on an agent-creation proposal.
 * Transition: simulated_approved → approved_for_execution (assigns a durable spec id).
 * This authorizes ONLY; it creates nothing. Real mutation also needs host gates (Key 2) + 18B.
 *
 * Usage:
 *   npm run agent:approve-execution -- --id=<proposal-id>
 *   npm run agent:approve-execution -- --number=<n>   (1-based, newest first)
 */

import { approveForExecution, type ProposalRef } from "../src/cockpit/proposals/proposal-queue.js";

function parseRef(): ProposalRef {
  const id = process.argv.find((a) => a.startsWith("--id="))?.replace("--id=", "");
  const numArg = process.argv.find((a) => a.startsWith("--number="))?.replace("--number=", "");
  if (id) return { id };
  if (numArg) return { number: Number.parseInt(numArg, 10) };
  throw new Error("Provide --id=<proposal-id> or --number=<n>.");
}

const cwd = process.cwd();
const now = new Date().toISOString();
const item = await approveForExecution(cwd, parseRef(), now);

if (!item) {
  console.error("Proposal not found.");
  process.exit(1);
}
if (item.status === "approved_for_execution") {
  console.log(`Authorized for execution: ${item.id}`);
  console.log(`Durable spec id: ${item.specId}`);
  console.log("Key 1 set. Host gates (Key 2) remain closed; nothing is created. Next: npm run agent:scaffold-dryrun");
} else {
  console.error(`Not authorized — status is "${item.status}" (requires simulated_approved). See audit log.`);
  process.exit(1);
}
