/**
 * scripts/provision-auto.ts
 *
 * Auto-provision: build a plan and run the engine.
 *
 * Global gates required:
 *   ALLOW_AUTO_PROVISION=true
 *
 * Environment gates:
 *   staging:    CONFIRM_STAGING_PROVISION=true
 *   production: CONFIRM_PRODUCTION_DEPLOY=true
 *
 * Provider gates: required per mutating step.
 *
 * Phase 6: real provider apply() is not_implemented.
 * Only mock steps and read-only (verify) steps complete.
 * All mutating real-provider steps are skipped with status=not_implemented.
 *
 * Usage:
 *   ALLOW_AUTO_PROVISION=true CONFIRM_STAGING_PROVISION=true npm run provision:auto -- --env=staging
 */

import path from "node:path";
import { buildProvisionPlan, getDefaultAdapters, buildContext } from "../src/provisioning/plan.js";
import { runProvisionEngine } from "../src/provisioning/engine.js";
import {
  checkAutoProvisionGate,
  checkEnvironmentGate,
  buildGateSummary,
} from "../src/provisioning/gates.js";
import {
  formatProvisionResult,
  writeReport,
  makeReportFilename,
} from "../src/provisioning/report.js";
import {
  buildLedgerEntries,
  appendToLedger,
  assertLedgerNoSecrets,
} from "../src/provisioning/ledger.js";
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

// ─── Gate checks ─────────────────────────────────────────────────────────────

const globalGate = checkAutoProvisionGate(env);
if (!globalGate.allowed) {
  console.log("Auto-provision is gated.");
  console.log("");
  console.log(globalGate.message);
  console.log("");
  console.log("Set ALLOW_AUTO_PROVISION=true to proceed.");
  console.log("Run 'npm run provision:plan' to preview the plan without gates.");
  process.exit(0);
}

const envGate = checkEnvironmentGate(env, environment);
if (!envGate.allowed) {
  console.log(`${environment} provision gate not open.`);
  console.log("");
  console.log(envGate.message);
  for (const gate of envGate.missingGates) {
    console.log(`  Set ${gate}=true to proceed.`);
  }
  process.exit(0);
}

// ─── Print gate summary ───────────────────────────────────────────────────────

console.log(`Auto-provision: ${agentName} → ${environment}`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");
console.log("Gate status:");
for (const g of buildGateSummary(env, environment)) {
  const icon = g.open ? "✓" : "○";
  console.log(`  ${icon} ${g.gateName}: ${g.note}`);
}
console.log("");

// ─── Build plan ───────────────────────────────────────────────────────────────

const context = buildContext(agentName, environment);
const adapters = await getDefaultAdapters();
const plan = await buildProvisionPlan(context, adapters);

console.log(
  `Plan: ${plan.totalSteps} steps (${plan.mutatingSteps} mutating, ${plan.readOnlySteps} read-only)`
);
console.log("");

// ─── Run engine ───────────────────────────────────────────────────────────────

const result = await runProvisionEngine(plan, adapters, context);
const formatted = formatProvisionResult(result);

console.log(formatted);

// ─── Write ledger ─────────────────────────────────────────────────────────────

const entries = buildLedgerEntries(result, environment);
const ledger = await appendToLedger(reportsDir, agentName, entries);
assertLedgerNoSecrets(ledger);
console.log(`Ledger updated: ${path.join(reportsDir, "provision-ledger.json")}`);

// ─── Write report ─────────────────────────────────────────────────────────────

const reportFilename = makeReportFilename("provision-report", environment);
const reportPath = await writeReport(reportsDir, reportFilename, formatted);
console.log(`Report written to: ${reportPath}`);

console.log("");
console.log(`Result: ${result.success ? "success" : "partial"}`);
console.log(`  Applied:          ${result.appliedCount}`);
console.log(`  Not implemented:  ${result.notImplementedCount} (Phase 7 scope)`);
console.log(`  Gate missing:     ${result.gateMissingCount}`);
console.log(`  Failed:           ${result.failedCount}`);

if (result.notImplementedCount > 0) {
  console.log("");
  console.log(
    `Note: ${result.notImplementedCount} step(s) are not_implemented in Phase 6.`
  );
  console.log("Real provider apply() adapters will be added in Phase 7.");
}
