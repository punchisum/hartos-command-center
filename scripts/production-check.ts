/**
 * scripts/production-check.ts
 *
 * Pre-production readiness check. No mutations. Safe to run anytime.
 * Shows: all gates status, staging proof, provider status.
 *
 * Usage: npm run production:check
 */

import { checkProductionReadiness } from "../src/launch/production-readiness.js";
import { getEnv } from "../src/runtime/env.js";

const root = process.cwd();
const env = getEnv() as Record<string, string | undefined>;

console.log(`Production readiness check: test-agent`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

const result = await checkProductionReadiness(env, root);
const maxLen = Math.max(...result.checks.map((c) => c.name.length));

for (const check of result.checks) {
  const icon = check.ok ? "✓" : "○";
  const pad = " ".repeat(maxLen - check.name.length + 2);
  console.log(`  ${icon} ${check.name}${pad}${check.note}`);
}

console.log("");
console.log(`Overall: ${result.ready ? "READY FOR PROMOTION" : "NOT READY"}`);

if (result.missingGates.length > 0) {
  console.log("");
  console.log("Set these to enable production promotion:");
  for (const gate of result.missingGates) {
    console.log(`  ${gate}=true`);
  }
}

if (result.warnings.length > 0) {
  console.log("");
  console.log("Warnings:");
  for (const w of result.warnings) {
    console.log(`  ⚠ ${w}`);
  }
}

console.log("");
console.log("Run 'npm run promote:production' when ready.");
