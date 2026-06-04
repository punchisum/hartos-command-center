/**
 * scripts/provision-rollback-plan.ts
 *
 * Generate a rollback plan from the provisioning ledger.
 * No gates required. No mutations. Never executes rollback.
 *
 * Usage:
 *   npm run provision:rollback-plan
 *   npm run provision:rollback-plan -- --env=staging
 */

import path from "node:path";
import { loadLedger } from "../src/provisioning/ledger.js";
import { buildRollbackPlan } from "../src/provisioning/rollback.js";
import { writeReport, makeReportFilename } from "../src/provisioning/report.js";
import type { ProvisionEnvironment } from "../src/provisioning/types.js";

const agentName = "test-agent";
const root = process.cwd();
const reportsDir = path.join(root, "provision-reports");

function parseEnvArg(): ProvisionEnvironment {
  const arg = process.argv.find((a) => a.startsWith("--env="));
  const value = arg ? arg.replace("--env=", "") : (process.env["APP_ENV"] ?? "local");
  if (value === "staging" || value === "production") return value;
  return "local";
}

const environment = parseEnvArg();

console.log(`Provision rollback plan: ${agentName} → ${environment}`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

const ledger = await loadLedger(reportsDir);

if (!ledger) {
  console.log("No provisioning ledger found.");
  console.log(
    "Run 'npm run provision:auto' first to create a ledger, then generate a rollback plan."
  );
  console.log("");
  console.log("Generating empty rollback plan for reference:");
  const emptyLedger = { agentName, entries: [], lastUpdated: new Date().toISOString() };
  const plan = buildRollbackPlan(emptyLedger, environment);
  console.log(plan.formatted);
  process.exit(0);
}

const plan = buildRollbackPlan(ledger, environment);
console.log(plan.formatted);

const filename = makeReportFilename("provision-rollback", environment);
const reportPath = await writeReport(reportsDir, filename, plan.formatted);
console.log(`Rollback plan written to: ${reportPath}`);
console.log("");
console.log("Note: Phase 6 generates the plan only. Rollback execution in Phase 7.");
