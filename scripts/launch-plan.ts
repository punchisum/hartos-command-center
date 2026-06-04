/**
 * scripts/launch-plan.ts
 *
 * Show the staging launch plan — what will run, in what order.
 * No mutations. No gates required. Safe to run anytime.
 *
 * Usage:
 *   npm run launch:plan
 */

import { buildProvisionPlan, getDefaultAdapters, buildContext } from "../src/provisioning/plan.js";
import { formatProvisionPlan } from "../src/provisioning/report.js";
import { checkLaunchReadiness } from "../src/launch/readiness.js";
import { getEnv } from "../src/runtime/env.js";

const agentName = "test-agent";
const env = getEnv() as Record<string, string | undefined>;
const root = process.cwd();

console.log(`Staging launch plan: ${agentName}`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

// 1. Readiness overview
const readiness = await checkLaunchReadiness(env, root);
const maxLen = Math.max(...readiness.checks.map((c) => c.name.length));
console.log("Readiness checks:");
for (const check of readiness.checks) {
  const icon = check.ok ? "✓" : "○";
  const pad = " ".repeat(maxLen - check.name.length + 2);
  console.log(`  ${icon} ${check.name}${pad}${check.note}`);
}
console.log("");

// 2. Provider launch order
console.log("Provider launch order:");
console.log("  1. GitHub");
console.log("  2. OpenAI");
console.log("  3. Supabase");
console.log("  4. Cloudflare");
console.log("  5. Telegram");
console.log("  6. Trigger.dev");
console.log("  7. Staging smoke");
console.log("  8. Launch report + rollback plan");
console.log("");

// 3. Full provision plan
const adapters = await getDefaultAdapters();
const context = buildContext(agentName, "staging");
const plan = await buildProvisionPlan(context, adapters);
console.log(formatProvisionPlan(plan));

if (readiness.missingGates.length > 0) {
  console.log("To run launch:staging with full automation, set these gates:");
  for (const gate of readiness.missingGates) {
    console.log(`  ${gate}=true`);
  }
  console.log("");
}
console.log("Run 'npm run launch:staging' to execute.");
