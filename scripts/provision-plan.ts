/**
 * scripts/provision-plan.ts
 *
 * Build and print a provision plan. No gates required. No mutations.
 * Writes the plan to provision-reports/.
 *
 * Usage:
 *   npm run provision:plan
 *   npm run provision:plan -- --env=staging
 *   npm run provision:plan -- --env=production
 */

import path from "node:path";
import { buildProvisionPlan, getDefaultAdapters, buildContext } from "../src/provisioning/plan.js";
import { formatProvisionPlan, writeReport, makeReportFilename } from "../src/provisioning/report.js";
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
const context = buildContext(agentName, environment);
const adapters = await getDefaultAdapters();

console.log(`Provision plan: ${agentName} → ${environment}`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

const plan = await buildProvisionPlan(context, adapters);
const formatted = formatProvisionPlan(plan);

console.log(formatted);

const filename = makeReportFilename("provision-plan", environment);
const reportPath = await writeReport(reportsDir, filename, formatted);
console.log(`Plan written to: ${reportPath}`);
console.log("");
console.log(
  `To apply mutating steps: set required gates and run 'npm run provision:auto -- --env=${environment}'`
);
