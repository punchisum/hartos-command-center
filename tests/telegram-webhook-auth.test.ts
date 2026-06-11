import { test } from "node:test";
import assert from "node:assert/strict";
import { handleTelegramWebhook } from "../src/telegram/webhook.js";
import type { Env, RuntimeDeps } from "../src/shared/types.js";

function deps(): RuntimeDeps {
  return {
    sender: { sendMessage: async () => {} },
    trigger: { enqueue: async () => {} },
    supabase: { insertDebugEvent: async () => {}, insertCommandEvent: async () => {} },
  };
}

function webhookRequest(secret?: string, body = "{}"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== undefined) headers["x-telegram-bot-api-secret-token"] = secret;
  return new Request("http://local.test/telegram/webhook", { method: "POST", headers, body });
}

test("rejects a wrong webhook secret with 401", async () => {
  const env: Env = { TELEGRAM_WEBHOOK_SECRET: "expected-secret" };
  const response = await handleTelegramWebhook(webhookRequest("wrong-secret"), env, deps());
  assert.equal(response.status, 401);
});

test("rejects a missing secret header when a secret is configured", async () => {
  const env: Env = { TELEGRAM_WEBHOOK_SECRET: "expected-secret" };
  const response = await handleTelegramWebhook(webhookRequest(), env, deps());
  assert.equal(response.status, 401);
});

test("accepts the correct webhook secret", async () => {
  const env: Env = { TELEGRAM_WEBHOOK_SECRET: "expected-secret" };
  const response = await handleTelegramWebhook(webhookRequest("expected-secret"), env, deps());
  assert.equal(response.status, 200);
});

test("fails closed in production when no secret is configured", async () => {
  const env: Env = { APP_ENV: "production" };
  const response = await handleTelegramWebhook(webhookRequest(), env, deps());
  assert.equal(response.status, 401);
});

test("stays open outside production when no secret is configured (local tests)", async () => {
  const env: Env = { APP_ENV: "local" };
  const response = await handleTelegramWebhook(webhookRequest(), env, deps());
  assert.equal(response.status, 200);
});

test("rejects malformed JSON bodies with 400", async () => {
  const env: Env = { TELEGRAM_WEBHOOK_SECRET: "expected-secret" };
  const response = await handleTelegramWebhook(webhookRequest("expected-secret", "{not json"), env, deps());
  assert.equal(response.status, 400);
});
