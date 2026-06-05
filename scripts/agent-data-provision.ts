/**
 * scripts/agent-data-provision.ts
 *
 * Phase 18C — apply a generated agent's Supabase migrations to an EXPLICITLY selected
 * existing test/staging project. GATED: with any gate closed it prints a dry-run report
 * (plan + destructive scan + rollback plan) and touches no database. Node CLI only.
 * Creates no project, deploys nothing, registers nothing, merges nothing, runs no agent.
 * Production is hard-refused.
 *
 * Usage (set gates on the host; never commit secrets):
 *   # Dry-run (default — safe):
 *   npm run agent:data-provision -- --id=<proposal-id>
 *
 *   # Real apply to a staging/test project:
 *   ALLOW_SUPABASE_MIGRATION_APPLY=true CONFIRM_DATA_LAYER_MUTATION=true \
 *   HARTOS_SUPABASE_PROJECT_REF=<ref> CONFIRM_SUPABASE_TARGET_PROJECT=<ref> \
 *   HARTOS_TARGET_ENV=staging HARTOS_SUPABASE_URL=<url> HARTOS_SUPABASE_ACCESS_TOKEN=<token> \
 *   npm run agent:data-provision -- --id=<proposal-id>
 */

import { runDataLayerProvision, DataProvisionPreconditionError } from "../src/execution/agent-data-provision.js";
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
  const r = await runDataLayerProvision({ cwd, ref: parseRef(), now });
  console.log(
    `Data-layer provision: ${r.mode.toUpperCase()} for ${r.agentName} (spec ${r.specId}) — ` +
      `${r.migrationCount} migration(s), risk=${r.overallRisk}, applied=${r.applied}, providerMutations=${r.providerMutations}.`
  );
  for (const line of r.instructions) console.log(`  ${line}`);
  console.log(`  Report:        ${r.reportPath}`);
  console.log(`  Rollback plan: ${r.rollbackPlanPath}`);
  if (r.smoke) {
    console.log("  Smoke (read-only):");
    for (const s of r.smoke) console.log(`    ${s.exists ? "✓" : "✗"} ${s.table} (${s.status})`);
  }
  process.exit(0);
} catch (err) {
  if (err instanceof DataProvisionPreconditionError) {
    console.error(`Data-layer provision refused: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
