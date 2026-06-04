/**
 * scripts/provision-verify.ts
 *
 * Run provider verification checks. No gates required. No mutations.
 * Prints the provider status matrix.
 *
 * Usage:
 *   npm run provision:verify
 *   npm run provision:verify -- --env=staging
 */

import path from "node:path";
import { getDefaultAdapters, buildContext } from "../src/provisioning/plan.js";
import { buildStatusMatrix, formatStatusMatrix } from "../src/provisioning/status-matrix.js";
import { buildGateSummary } from "../src/provisioning/gates.js";
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
const env = process.env as Record<string, string | undefined>;

console.log(`Provider verification: ${agentName} → ${environment}`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

const context = buildContext(agentName, environment);
const adapters = await getDefaultAdapters();
const matrix = await buildStatusMatrix(adapters, context);
const formatted = formatStatusMatrix(matrix);

console.log(formatted);

// Print gate status (informational)
console.log("Provision gates:");
for (const g of buildGateSummary(env, environment)) {
  const icon = g.open ? "✓" : "○";
  console.log(`  ${icon} ${g.gateName}: ${g.note}`);
}
console.log("");

// Write verification report
const filename = makeReportFilename("provision-verify", environment);
const reportPath = await writeReport(reportsDir, filename, formatted);
console.log(`Verification report written to: ${reportPath}`);
