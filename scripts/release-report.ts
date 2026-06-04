/**
 * scripts/release-report.ts
 *
 * Generate a deployment release report from current ledger and env state.
 * No side effects. Safe to run at any time.
 *
 * Security: never includes secret values in the report.
 *
 * Usage:
 *   npm run release:report
 *   APP_ENV=staging npm run release:report
 */

import path from "node:path";
import { getEnv, optionalEnv } from "../src/runtime/env.js";
import { planMigrations } from "../src/supabase/migration-runner.js";
import {
  buildDeploymentReport,
  formatDeploymentReport,
  writeDeploymentReport,
  type DeploymentEnvironment,
} from "../src/runtime/deployment-report.js";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const env = getEnv();
const rawEnv = optionalEnv(env, "APP_ENV") ?? "local";
const environment = (
  rawEnv === "staging" || rawEnv === "production" ? rawEnv : "local"
) as DeploymentEnvironment;
const agentName = "test-agent";

const root = process.cwd();
const migrationsDir = path.join(root, "supabase", "migrations");
const ledgerPath = path.join(root, ".migration-ledger.json");
const reportsDir = path.join(root, "migration-reports");

const plan = existsSync(migrationsDir)
  ? await planMigrations(migrationsDir, ledgerPath, agentName, environment)
  : null;

const workerUrl =
  environment === "production"
    ? optionalEnv(env, "PRODUCTION_CLOUDFLARE_WORKER_URL")
    : optionalEnv(env, "STAGING_CLOUDFLARE_WORKER_URL") ??
      optionalEnv(env, "CLOUDFLARE_WORKER_URL");

// Verify health if URL configured
let cloudflareHealthy: boolean | null = null;
if (workerUrl) {
  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, "")}/health`);
    cloudflareHealthy = res.ok;
  } catch {
    cloudflareHealthy = false;
  }
}

const report = buildDeploymentReport({
  agentName,
  environment,
  migrationsApplied: plan?.applied ?? [],
  migrationsPending: plan?.pending.map((m) => m.filename) ?? [],
  migrationErrors: plan?.errors ?? [],
  cloudflareDeployed: Boolean(workerUrl),
  cloudflareHealthy,
  telegramWebhookRegistered: Boolean(optionalEnv(env, "TELEGRAM_WEBHOOK_URL")),
  triggerReady: Boolean(optionalEnv(env, "TRIGGER_SECRET_KEY")),
  smokeTestPassed: null,
  notes: [
    "Release report generated from current env state and migration ledger.",
    "Run 'npm run smoke:staging' or 'npm run smoke:production' to update smoke test status.",
  ],
  warnings:
    (plan?.errors.length ?? 0) > 0
      ? [`${plan!.errors.length} migration validation error(s) — run 'npm run migrations:plan'`]
      : [],
});

const formatted = formatDeploymentReport(report);
console.log(formatted);

await mkdir(reportsDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(reportsDir, `release-${environment}-${ts}.md`);
await writeDeploymentReport(report, reportPath);
console.log(`Report written to: ${reportPath}`);
