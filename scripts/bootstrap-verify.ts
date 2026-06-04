/**
 * scripts/bootstrap-verify.ts
 *
 * Verify bootstrap completed correctly.
 * Shows current provider scope status.
 *
 * Usage: npm run bootstrap:verify
 */

import { getEnv } from "../src/runtime/env.js";
import { checkAllProviderScopes } from "../src/bootstrap/provider-scope-check.js";
import { checkBootstrap } from "../src/bootstrap/bootstrap-check.js";

const env = getEnv() as Record<string, string | undefined>;

console.log(`Bootstrap verify: test-agent`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

const scopes = checkAllProviderScopes(env);
const plan = await checkBootstrap(env);

// Provider status
console.log("Provider readiness:");
for (const scope of scopes) {
  const icon = scope.configured ? "✓" : "✗";
  console.log(`  ${icon} ${scope.provider}`);
  if (!scope.configured) {
    console.log(`    Missing: ${scope.missingEnv.join(", ")}`);
  } else {
    console.log(`    Capabilities: ${scope.capabilities.join(", ")}`);
  }
}
console.log("");

// Summary
const configuredCount = scopes.filter((s) => s.configured).length;
console.log(`Configured: ${configuredCount}/${scopes.length} providers`);
console.log(`Manual steps: ${plan.manualCount}`);
console.log(`Missing env: ${plan.missingEnvCount}`);
console.log("");

if (plan.missingGates.length > 0) {
  console.log("Bootstrap gates needed:");
  for (const gate of plan.missingGates) {
    console.log(`  ${gate}=true`);
  }
  console.log("");
}

if (configuredCount === scopes.length && plan.missingGates.length === 0) {
  console.log("Bootstrap verification: READY");
} else {
  console.log("Bootstrap verification: INCOMPLETE");
  console.log("Run 'npm run bootstrap:check' for detailed guidance.");
}
