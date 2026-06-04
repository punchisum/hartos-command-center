/**
 * scripts/observability-check.ts
 *
 * Check Supabase debug_events observability. Read-only.
 * Degrades safely when Supabase env is missing.
 * NEVER prints service role key.
 *
 * Usage: npm run observability:check
 */

import { getEnv } from "../src/runtime/env.js";
import { checkObservability } from "../src/launch/observability-check.js";

const env = getEnv() as Record<string, string | undefined>;

console.log(`Observability check: test-agent`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

const result = await checkObservability(env);

console.log(`Status: ${result.status}`);
console.log(`Recent events (${24}h): ${result.recentEvents}`);
if (result.errorRate !== null) {
  console.log(`Error rate: ${result.errorRate}%`);
}
console.log(`Message: ${result.message}`);
console.log(`Next: ${result.nextAction}`);
