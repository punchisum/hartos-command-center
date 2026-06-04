/**
 * scripts/launch-verify.ts
 *
 * Verify all providers are configured for staging launch.
 * No mutations. No gates required. Safe to run anytime.
 *
 * Usage:
 *   npm run launch:verify
 */

import { getDefaultAdapters, buildContext } from "../src/provisioning/plan.js";
import { buildStatusMatrix, formatStatusMatrix } from "../src/provisioning/status-matrix.js";
import { checkLaunchReadiness } from "../src/launch/readiness.js";
import { getEnv } from "../src/runtime/env.js";

const agentName = "test-agent";
const env = getEnv() as Record<string, string | undefined>;
const root = process.cwd();

console.log(`Staging launch verify: ${agentName}`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

// 1. Readiness check
const readiness = await checkLaunchReadiness(env, root);
const missingGates = readiness.missingGates.length;
console.log(
  `Readiness: ${readiness.ready ? "ok" : "issues"} ` +
  `(${missingGates} gate(s) not yet set)`
);
console.log("");

// 2. Full provider status matrix
const adapters = await getDefaultAdapters();
const context = buildContext(agentName, "staging");
const matrix = await buildStatusMatrix(adapters, context);
console.log(formatStatusMatrix(matrix));

// 3. Summary
if (!readiness.ready || matrix.missingEnvCount > 0) {
  console.log("To configure all providers:");
  for (const ps of matrix.providers.filter((p) => p.status !== "configured")) {
    if (ps.missingEnv.length > 0) {
      console.log(`  ${ps.provider}: set ${ps.missingEnv.join(", ")}`);
    }
  }
  console.log("");
}

if (missingGates > 0) {
  console.log(`To enable mutations, set ${missingGates} gate(s):`);
  for (const gate of readiness.missingGates.slice(0, 8)) {
    console.log(`  ${gate}=true`);
  }
  console.log("");
}

console.log("Run 'npm run launch:plan' to see the full launch plan.");
console.log("Run 'npm run launch:staging' to execute the launch.");
