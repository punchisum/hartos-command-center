/**
 * scripts/agent-runtime-provision-rollback.ts
 *
 * Phase 18D — MANUAL runtime rollback. Surfaces the most recent rollback plan and prints manual
 * instructions. It deletes no Worker and touches no webhook (the webhook auto-revert happens inline
 * during a FAILED deploy, not here). Node CLI only.
 *
 * Usage:
 *   npm run agent:runtime-provision-rollback -- --id=<proposal-id>
 */

import { runRuntimeRollback, RuntimeProvisionPreconditionError } from "../src/execution/agent-runtime-provision.js";
import type { ProposalRef } from "../src/cockpit/proposals/proposal-queue.js";

function parseRef(): ProposalRef {
  const id = process.argv.find((a) => a.startsWith("--id="))?.replace("--id=", "");
  const numArg = process.argv.find((a) => a.startsWith("--number="))?.replace("--number=", "");
  if (id) return { id };
  if (numArg) return { number: Number.parseInt(numArg, 10) };
  throw new Error("Provide --id=<proposal-id> or --number=<n>.");
}

const cwd = process.cwd();
const now = new Date().toISOString();

try {
  const r = await runRuntimeRollback({ cwd, ref: parseRef(), now });
  console.log(`Runtime rollback (manual) for spec ${r.specId}:`);
  for (const line of r.instructions) console.log(`  ${line}`);
  process.exit(0);
} catch (err) {
  if (err instanceof RuntimeProvisionPreconditionError) {
    console.error(`Runtime rollback refused: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
