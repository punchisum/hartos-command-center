/**
 * scripts/promote.ts
 *
 * Promotion workflow: local → staging OR staging → production.
 *
 * Orchestrates:
 *   1. Deployment readiness check
 *   2. Migration plan (prints pending — never auto-applies)
 *   3. Cloudflare deploy (if ALLOW_CLOUDFLARE_DEPLOY=true)
 *   4. Telegram webhook register (if ALLOW_TELEGRAM_WEBHOOK_REGISTER=true)
 *   5. Smoke test
 *   6. Release report
 *
 * Each step that mutates infrastructure requires an explicit gate env var.
 * No step silently mutates live infrastructure.
 *
 * Usage:
 *   APP_ENV=staging npm run deploy:staging
 *   APP_ENV=production CONFIRM_PRODUCTION_DEPLOY=true npm run promote:production
 */

import { spawn } from "node:child_process";
import { getEnv, optionalEnv } from "../src/runtime/env.js";

const env = getEnv();
const environment = optionalEnv(env, "APP_ENV") ?? "local";
const node = process.execPath;

function step(name: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`▶ ${name}`);
  console.log(`${"─".repeat(60)}`);
}

async function run(script: string, extraEnv: Record<string, string> = {}): Promise<number> {
  const child = spawn(node, ["--import", "tsx/esm", script], {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    shell: false,
  });
  return new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 0));
    child.on("error", (err) => {
      console.error(`Failed to run ${script}:`, err.message);
      resolve(1);
    });
  });
}

// For production, the full set of gates must be set before any step runs.
if (environment === "production" && env.CONFIRM_PRODUCTION_DEPLOY !== "true") {
  console.log("Production promotion requires CONFIRM_PRODUCTION_DEPLOY=true.");
  console.log("");
  console.log("Before promoting to production:");
  console.log("  1. Confirm staging smoke tests passed.");
  console.log("  2. Review the migration plan: npm run migrations:plan");
  console.log("  3. Set CONFIRM_PRODUCTION_DEPLOY=true.");
  console.log("");
  console.log("No changes made.");
  process.exit(0);
}

// ─── Step 1: Readiness check ──────────────────────────────────────────────────
step("1. Deployment readiness check");
await run("dist/scripts/check-deployment-readiness.js");

// ─── Step 2: Migration plan ───────────────────────────────────────────────────
step("2. Migration plan (no apply — review only)");
await run("dist/scripts/plan-supabase-migrations.js");

// ─── Step 3: Apply migrations (gated) ────────────────────────────────────────
step("3. Migration apply (gated by ALLOW_SUPABASE_MIGRATION_APPLY)");
if (env.ALLOW_SUPABASE_MIGRATION_APPLY === "true") {
  const code = await run("dist/scripts/apply-supabase-migrations.js");
  if (code !== 0) {
    console.error("Migration apply failed. Promotion stopped.");
    process.exit(1);
  }
} else {
  console.log("ALLOW_SUPABASE_MIGRATION_APPLY not set — skipping migration apply.");
  console.log("Apply migrations manually, then re-run this workflow.");
}

// ─── Step 4: Cloudflare deploy (gated) ───────────────────────────────────────
step("4. Cloudflare deploy (gated by ALLOW_CLOUDFLARE_DEPLOY)");
if (env.ALLOW_CLOUDFLARE_DEPLOY === "true") {
  const code = await run("dist/scripts/deploy-cloudflare.js");
  if (code !== 0) {
    console.error("Cloudflare deploy failed. Promotion stopped.");
    process.exit(1);
  }
} else {
  console.log("ALLOW_CLOUDFLARE_DEPLOY not set — skipping deploy.");
}

// ─── Step 5: Telegram webhook (gated) ────────────────────────────────────────
step("5. Telegram webhook registration (gated by ALLOW_TELEGRAM_WEBHOOK_REGISTER)");
if (env.ALLOW_TELEGRAM_WEBHOOK_REGISTER === "true") {
  const code = await run("dist/scripts/register-telegram-webhook.js");
  if (code !== 0) {
    console.error("Telegram webhook registration failed.");
    // Non-fatal — deployment can continue
  }
} else {
  console.log("ALLOW_TELEGRAM_WEBHOOK_REGISTER not set — skipping webhook registration.");
}

// ─── Step 6: Smoke test ───────────────────────────────────────────────────────
step(`6. Smoke test (${environment})`);
const smokeScript =
  environment === "production"
    ? "dist/scripts/run-production-smoke.js"
    : "dist/scripts/run-staging-smoke.js";
const smokeCode = await run(smokeScript);
if (smokeCode !== 0) {
  console.error("Smoke test failed.");
  console.error("Run 'npm run rollback:plan' to generate a rollback runbook.");
  process.exit(1);
}

// ─── Step 7: Release report ───────────────────────────────────────────────────
step("7. Release report");
await run("dist/scripts/release-report.js");

console.log(`\n${"═".repeat(60)}`);
console.log(`✓ Promotion to ${environment} complete.`);
console.log(`${"═".repeat(60)}`);
