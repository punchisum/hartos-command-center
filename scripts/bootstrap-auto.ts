/**
 * scripts/bootstrap-auto.ts
 *
 * Execute bootstrap steps behind gates.
 *
 * Gates required:
 *   ALLOW_BOOTSTRAP_PROVISION=true
 *   CONFIRM_BOOTSTRAP_PROVISION=true
 *
 * Usage:
 *   ALLOW_BOOTSTRAP_PROVISION=true CONFIRM_BOOTSTRAP_PROVISION=true npm run bootstrap:auto
 */

import path from "node:path";
import { getEnv } from "../src/runtime/env.js";
import { runBootstrapEngine } from "../src/bootstrap/bootstrap-engine.js";
import { formatBootstrapResult, writeBootstrapReport } from "../src/bootstrap/bootstrap-report.js";

const root = process.cwd();
const env = getEnv() as Record<string, string | undefined>;
const reportsDir = path.join(root, "bootstrap-reports");

console.log(`Bootstrap auto: test-agent`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

if (env["ALLOW_BOOTSTRAP_PROVISION"] !== "true" || env["CONFIRM_BOOTSTRAP_PROVISION"] !== "true") {
  console.log("Bootstrap auto is gated.");
  console.log("");
  console.log("Set these to proceed:");
  if (env["ALLOW_BOOTSTRAP_PROVISION"] !== "true") console.log("  ALLOW_BOOTSTRAP_PROVISION=true");
  if (env["CONFIRM_BOOTSTRAP_PROVISION"] !== "true") console.log("  CONFIRM_BOOTSTRAP_PROVISION=true");
  console.log("");
  console.log("Run 'npm run bootstrap:plan' to preview what would happen.");
  process.exit(0);
}

const result = await runBootstrapEngine({ env, reportsDir });
const formatted = formatBootstrapResult(result);
console.log(formatted);

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = await writeBootstrapReport(formatted, reportsDir, `bootstrap-result-${ts}.md`);
console.log(`Result written to: ${reportPath}`);

if (result.status === "manual_required") {
  console.log("Manual steps remain. Complete them and re-run bootstrap:auto.");
  process.exit(0);
}
