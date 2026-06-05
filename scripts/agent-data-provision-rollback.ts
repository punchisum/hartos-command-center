/**
 * scripts/agent-data-provision-rollback.ts
 *
 * Phase 18C — surface the MANUAL rollback plan for a generated agent's applied migrations.
 * Rollback is manual-only in 18C: this never connects to a database and never drops data.
 *
 * Usage:
 *   npm run agent:data-provision-rollback -- --id=<proposal-id>
 */

import { runDataLayerRollback, DataProvisionPreconditionError } from "../src/execution/agent-data-provision.js";
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
  const r = await runDataLayerRollback({ cwd, ref: parseRef(), now });
  console.log(`Data-layer rollback (manual) for spec ${r.specId}:`);
  for (const line of r.instructions) console.log(`  ${line}`);
  process.exit(0);
} catch (err) {
  if (err instanceof DataProvisionPreconditionError) {
    console.error(`Rollback refused: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
