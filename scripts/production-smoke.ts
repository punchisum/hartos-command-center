/**
 * scripts/production-smoke.ts
 *
 * Run a read-only smoke check against production environment.
 * No mutations. Degrades safely if env is missing.
 *
 * Smoke statuses:
 *   PASSED          — all providers configured, health check ok
 *   DEGRADED_SAFE   — providers missing/partial, no failures
 *   SKIPPED_NO_ENV  — no providers configured at all
 *   FAILED          — health check returned non-200 or network error
 *
 * Usage: npm run production:smoke
 */

import { getEnv, optionalEnv, checkProviderStatus } from "../src/runtime/env.js";

const env = getEnv();
const agentName = "test-agent";

console.log(`Production smoke: ${agentName}`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

const notes: string[] = [];
let healthFailed = false;
let healthChecked = false;

// Provider status
const statuses = checkProviderStatus(env);
const configuredCount = statuses.filter((ps) => ps.configured).length;
const totalProviders = statuses.length;

for (const ps of statuses) {
  if (!ps.configured) {
    const missing = ps.checks.filter((c) => !c.present).map((c) => c.name);
    notes.push(`${ps.provider}: missing ${missing.join(", ")}`);
  } else {
    notes.push(`${ps.provider}: configured ✓`);
  }
}

// Production Worker health
const workerUrl =
  optionalEnv(env, "PRODUCTION_CLOUDFLARE_WORKER_URL") ??
  optionalEnv(env, "CLOUDFLARE_WORKER_URL");

if (workerUrl) {
  healthChecked = true;
  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, "")}/health`);
    if (res.ok) {
      notes.push(`cloudflare /health: ok`);
    } else {
      notes.push(`cloudflare /health: HTTP ${res.status}`);
      healthFailed = true;
    }
  } catch {
    notes.push(`cloudflare /health: unreachable`);
    healthFailed = true;
  }
} else {
  notes.push("cloudflare /health: skipped — PRODUCTION_CLOUDFLARE_WORKER_URL not set");
}

for (const note of notes) console.log(`  ${note}`);
console.log("");

// Determine smoke status — never misleadingly print PASSED when providers aren't configured
let smokeStatus: string;
if (healthFailed) {
  smokeStatus = "FAILED";
} else if (configuredCount === 0 && !healthChecked) {
  smokeStatus = "SKIPPED_NO_ENV";
} else if (configuredCount < totalProviders || !healthChecked) {
  smokeStatus = "DEGRADED_SAFE";
} else {
  smokeStatus = "PASSED";
}

console.log(`Production smoke: ${smokeStatus}`);
if (smokeStatus === "DEGRADED_SAFE") {
  console.log(`  ${configuredCount}/${totalProviders} providers configured.`);
  console.log(`  Configure remaining providers for a full smoke check.`);
} else if (smokeStatus === "SKIPPED_NO_ENV") {
  console.log(`  No provider env vars configured.`);
  console.log(`  Run 'npm run check:env' to see what's missing.`);
}
