/**
 * scripts/bootstrap-check.ts
 *
 * Bootstrap readiness check. No mutations. Safe to run anytime.
 * Shows: provider credentials, missing env, secrets needed.
 *
 * Usage: npm run bootstrap:check
 */

import path from "node:path";
import { getEnv } from "../src/runtime/env.js";
import { checkBootstrap } from "../src/bootstrap/bootstrap-check.js";
import { formatBootstrapPlan, writeBootstrapReport } from "../src/bootstrap/bootstrap-report.js";
import { checkAllProviderScopes } from "../src/bootstrap/provider-scope-check.js";
import { getMissingSecrets, formatSecretDestinations } from "../src/bootstrap/secret-destinations.js";

const root = process.cwd();
const env = getEnv() as Record<string, string | undefined>;
const reportsDir = path.join(root, "bootstrap-reports");

console.log(`Bootstrap check: test-agent`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

// Provider scope summary
const scopes = checkAllProviderScopes(env);
console.log("Provider credentials:");
for (const scope of scopes) {
  const icon = scope.configured ? "✓" : "✗";
  console.log(`  ${icon} ${scope.provider}: ${scope.safeSummary.replace(`${scope.provider}: `, "")}`);
}
console.log("");

// Bootstrap plan
const plan = await checkBootstrap(env);
console.log(`Summary: ${plan.summary}`);
console.log("");

if (plan.missingGates.length > 0) {
  console.log("Bootstrap gates not set:");
  for (const gate of plan.missingGates) {
    console.log(`  ${gate}=true`);
  }
  console.log("");
}

if (plan.missingEnv.length > 0) {
  console.log("Missing env vars:");
  for (const envVar of plan.missingEnv) {
    console.log(`  ${envVar}=`);
  }
  console.log("");
}

// Missing secrets guide
const missingSecrets = getMissingSecrets(env);
if (missingSecrets.length > 0) {
  console.log(`${missingSecrets.length} secret(s) not configured. See bootstrap-reports/ for configuration guide.`);
}

// Write reports
const planFormatted = formatBootstrapPlan(plan);
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const planPath = await writeBootstrapReport(planFormatted, reportsDir, `bootstrap-plan-${ts}.md`);

if (missingSecrets.length > 0) {
  const secretsGuide = formatSecretDestinations(missingSecrets, "test-agent");
  await writeBootstrapReport(secretsGuide, reportsDir, `secret-destinations-${ts}.md`);
  console.log(`Secret destinations guide written to: bootstrap-reports/`);
}

console.log(`Bootstrap plan written to: ${planPath}`);
console.log("");
console.log("Run 'npm run bootstrap:plan' to see the full plan.");
console.log("Run 'npm run bootstrap:auto' to execute automated steps.");
