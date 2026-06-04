/**
 * scripts/deploy-cloudflare.ts
 *
 * Deploy the Cloudflare Worker using wrangler.
 *
 * Gates:
 *   ALLOW_CLOUDFLARE_DEPLOY=true         required for any deploy
 *   CONFIRM_PRODUCTION_DEPLOY=true        required for production
 *
 * Never prints Cloudflare API token or account ID.
 * Verifies /health after deploy if CLOUDFLARE_WORKER_URL is set.
 *
 * Usage:
 *   ALLOW_CLOUDFLARE_DEPLOY=true npm run deploy:staging
 *   ALLOW_CLOUDFLARE_DEPLOY=true CONFIRM_PRODUCTION_DEPLOY=true npm run deploy:production
 *   ALLOW_CLOUDFLARE_DEPLOY=true APP_ENV=staging npm run deploy:staging
 */

import { spawn } from "node:child_process";
import { getEnv, optionalEnv } from "../src/runtime/env.js";

const env = getEnv();
const environment = optionalEnv(env, "APP_ENV") ?? "local";

// ─── Gate checks ─────────────────────────────────────────────────────────────

if (env.ALLOW_CLOUDFLARE_DEPLOY !== "true") {
  console.log("Cloudflare deploy is gated.");
  console.log("");
  console.log("Set ALLOW_CLOUDFLARE_DEPLOY=true to deploy.");
  console.log("For production, also set CONFIRM_PRODUCTION_DEPLOY=true.");
  console.log("");
  console.log("No deployment made.");
  process.exit(0);
}

if (environment === "production" && env.CONFIRM_PRODUCTION_DEPLOY !== "true") {
  console.log("Production deploy requires CONFIRM_PRODUCTION_DEPLOY=true.");
  console.log("");
  console.log("Set CONFIRM_PRODUCTION_DEPLOY=true once you have verified staging is healthy.");
  console.log("");
  console.log("No deployment made.");
  process.exit(0);
}

// ─── Deploy via wrangler ──────────────────────────────────────────────────────

const wranglerEnv = environment === "production" ? "production" : "staging";
console.log(`Deploying Cloudflare Worker: test-agent → ${wranglerEnv}`);
console.log("Running: wrangler deploy --env", wranglerEnv);
console.log("(Wrangler reads secrets from dashboard — no secrets printed here)");
console.log("");

const wrangler = spawn("wrangler", ["deploy", "--env", wranglerEnv], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

const exitCode = await new Promise<number>((resolve) => {
  wrangler.on("close", resolve);
  wrangler.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error("wrangler not found. Install with: npm install -g wrangler");
    } else {
      console.error("Wrangler error:", err.message);
    }
    resolve(1);
  });
});

if (exitCode !== 0) {
  console.error(`\nDeploy failed (exit ${exitCode}).`);
  process.exit(exitCode);
}

console.log("\nDeploy completed.");

// ─── Health check ─────────────────────────────────────────────────────────────

const workerUrl =
  environment === "production"
    ? optionalEnv(env, "PRODUCTION_CLOUDFLARE_WORKER_URL")
    : optionalEnv(env, "STAGING_CLOUDFLARE_WORKER_URL") ??
      optionalEnv(env, "CLOUDFLARE_WORKER_URL");

if (!workerUrl) {
  console.log(
    "No CLOUDFLARE_WORKER_URL configured — skipping health check."
  );
  process.exit(0);
}

console.log(`Verifying health: ${workerUrl}/health`);

try {
  const response = await fetch(`${workerUrl.replace(/\/$/, "")}/health`);
  if (response.ok) {
    console.log("Health check: ok");
  } else {
    console.error(`Health check failed: HTTP ${response.status}`);
    process.exit(1);
  }
} catch (err) {
  console.error("Health check error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
