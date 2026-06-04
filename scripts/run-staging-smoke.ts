/**
 * scripts/run-staging-smoke.ts
 *
 * Run smoke tests against the staging environment.
 * Requires staging env vars. Does not write to production.
 *
 * Usage:
 *   APP_ENV=staging npm run smoke:staging
 */

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { getEnv, optionalEnv, checkProviderStatus } from "../src/runtime/env.js";
import {
  buildDeploymentReport,
  writeDeploymentReport,
  formatDeploymentReport,
} from "../src/runtime/deployment-report.js";

const env = getEnv();
const agentName = "test-agent";
const root = process.cwd();

console.log(`Staging smoke: ${agentName}`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

const smokeNotes: string[] = [];
const warnings: string[] = [];
let smokeTestPassed = true;

// 1. Check provider env vars
const statuses = checkProviderStatus(env);
for (const ps of statuses) {
  if (!ps.configured) {
    const missing = ps.checks.filter((c) => !c.present).map((c) => c.name);
    warnings.push(`${ps.provider}: missing ${missing.join(", ")}`);
    smokeNotes.push(`${ps.provider}: not configured — skipped`);
  } else {
    smokeNotes.push(`${ps.provider}: configured ✓`);
  }
}

// 2. Check Cloudflare health
const workerUrl =
  optionalEnv(env, "STAGING_CLOUDFLARE_WORKER_URL") ??
  optionalEnv(env, "CLOUDFLARE_WORKER_URL");

let cloudflareHealthy: boolean | null = null;

if (workerUrl) {
  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, "")}/health`);
    cloudflareHealthy = res.ok;
    smokeNotes.push(`cloudflare /health: ${res.ok ? "ok" : `HTTP ${res.status}`}`);
    if (!res.ok) smokeTestPassed = false;
  } catch (err) {
    cloudflareHealthy = false;
    smokeTestPassed = false;
    smokeNotes.push(
      `cloudflare /health: error — ${err instanceof Error ? err.message : String(err)}`
    );
  }
} else {
  smokeNotes.push("cloudflare /health: skipped — STAGING_CLOUDFLARE_WORKER_URL not set");
  warnings.push("Set STAGING_CLOUDFLARE_WORKER_URL to enable Worker health check");
}

// 3. Trigger readiness
const triggerReady = Boolean(optionalEnv(env, "TRIGGER_SECRET_KEY"));
smokeNotes.push(`trigger: ${triggerReady ? "env present" : "TRIGGER_SECRET_KEY missing"}`);

// 4. Print results
for (const note of smokeNotes) console.log(`  ${note}`);
console.log("");

if (warnings.length > 0) {
  console.log("Warnings:");
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  console.log("");
}

console.log(`Staging smoke: ${smokeTestPassed ? "PASSED" : "FAILED"}`);

// 5. Write report
const report = buildDeploymentReport({
  agentName,
  environment: "staging",
  cloudflareDeployed: Boolean(workerUrl),
  cloudflareHealthy,
  telegramWebhookRegistered: Boolean(optionalEnv(env, "TELEGRAM_WEBHOOK_URL")),
  triggerReady,
  smokeTestPassed,
  smokeTestNotes: smokeNotes,
  warnings,
});

const reportsDir = path.join(root, "migration-reports");
await mkdir(reportsDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(reportsDir, `smoke-staging-${ts}.md`);
await writeDeploymentReport(report, reportPath);
console.log(`Smoke report written to: ${reportPath}`);

if (!smokeTestPassed) process.exit(1);
