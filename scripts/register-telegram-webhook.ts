/**
 * scripts/register-telegram-webhook.ts
 *
 * Register the Telegram webhook URL.
 *
 * Gates (Phase 5):
 *   ALLOW_TELEGRAM_WEBHOOK_REGISTER=true   required
 *   CONFIRM_PRODUCTION_DEPLOY=true          required for APP_ENV=production
 *
 * Never prints bot token or webhook secret.
 *
 * Usage:
 *   ALLOW_TELEGRAM_WEBHOOK_REGISTER=true npm run telegram:register-webhook
 *   ALLOW_TELEGRAM_WEBHOOK_REGISTER=true CONFIRM_PRODUCTION_DEPLOY=true APP_ENV=production npm run telegram:register-webhook
 */

import { getEnv, optionalEnv } from "../src/runtime/env.js";
import { registerTelegramWebhook } from "../src/telegram/register-webhook.js";

const env = getEnv();
const environment = optionalEnv(env, "APP_ENV") ?? "local";

// ─── Gate checks ─────────────────────────────────────────────────────────────

if (env.ALLOW_TELEGRAM_WEBHOOK_REGISTER !== "true") {
  console.log("Telegram webhook registration is gated.");
  console.log("");
  console.log("Set ALLOW_TELEGRAM_WEBHOOK_REGISTER=true to register the webhook.");
  console.log("For production, also set CONFIRM_PRODUCTION_DEPLOY=true.");
  console.log("");
  console.log("No registration performed.");
  process.exit(0);
}

if (environment === "production" && env.CONFIRM_PRODUCTION_DEPLOY !== "true") {
  console.log("Production webhook registration requires CONFIRM_PRODUCTION_DEPLOY=true.");
  console.log("");
  console.log("No registration performed.");
  process.exit(0);
}

// ─── Register ─────────────────────────────────────────────────────────────────

console.log(`Registering Telegram webhook for: ${environment}`);
console.log("Bot token and webhook secret are not printed.");

await registerTelegramWebhook(env);
console.log("Telegram webhook registration request completed.");
console.log("Verify with: npm run verify:telegram");
