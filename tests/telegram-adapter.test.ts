/**
 * tests/telegram-adapter.test.ts
 *
 * Tests for the Phase 7C real Telegram adapter.
 * All Telegram Bot API calls are mocked via injected TelegramOps factory.
 * No real Telegram API calls are performed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TelegramAdapter } from "../src/provisioning/adapters/telegram.js";
import {
  type TelegramOps,
  createMockTelegramOps,
} from "../src/provisioning/telegram-local.js";
import type { ProvisionContext, ProvisionStep } from "../src/provisioning/types.js";

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeCtx(
  env: Record<string, string> = {},
  environment: "local" | "staging" | "production" = "staging"
): ProvisionContext {
  return { agentName: "test-agent", environment, env };
}

function makeAdapter(opsOverrides: Partial<TelegramOps> = {}): TelegramAdapter {
  const ops = createMockTelegramOps(opsOverrides);
  return new TelegramAdapter(() => ops);
}

const baseEnv = {
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_WEBHOOK_URL: "https://worker.example.com/webhook",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
  TELEGRAM_ALLOWED_USER_IDS: "123456",
  TELEGRAM_ALLOWED_CHAT_IDS: "123456",
  TEST_TELEGRAM_CHAT_ID: "test-chat",
  ALLOW_TELEGRAM_PROVISION: "true",
  ALLOW_TELEGRAM_WEBHOOK_REGISTER: "true",
  ALLOW_TELEGRAM_TEST_SEND: "true",
  ALLOW_AUTO_PROVISION: "true",
  CONFIRM_STAGING_PROVISION: "true",
};

const registerStep: ProvisionStep = {
  id: "telegram:register_webhook:staging",
  provider: "telegram",
  action: "register_webhook",
  environment: "staging",
  mutation: true,
  requiredGate: "ALLOW_TELEGRAM_WEBHOOK_REGISTER",
  description: "Register webhook",
  safeSummary: "Registers Telegram webhook",
  status: "planned",
};

const testSendStep: ProvisionStep = {
  id: "telegram:test_send:staging",
  provider: "telegram",
  action: "test_send",
  environment: "staging",
  mutation: true,
  requiredGate: "ALLOW_TELEGRAM_TEST_SEND",
  description: "Send test message",
  safeSummary: "Sends test message",
  status: "planned",
};

const verifyBotStep: ProvisionStep = {
  id: "telegram:verify_bot:staging",
  provider: "telegram",
  action: "verify_bot",
  environment: "staging",
  mutation: false,
  description: "Verify bot",
  safeSummary: "Calls getMe",
  status: "planned",
};

const verifyWebhookStep: ProvisionStep = {
  id: "telegram:verify_webhook:staging",
  provider: "telegram",
  action: "verify_webhook",
  environment: "staging",
  mutation: false,
  description: "Verify webhook",
  safeSummary: "Calls getWebhookInfo",
  status: "planned",
};

// ─── Missing env ─────────────────────────────────────────────────────────────

describe("Telegram adapter — missing env", () => {
  test("missing TELEGRAM_BOT_TOKEN → missing_env", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx({ TELEGRAM_WEBHOOK_URL: "https://example.com" });
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "missing_env");
    assert.ok(vr.missingEnv.includes("TELEGRAM_BOT_TOKEN"));
  });

  test("missing TELEGRAM_WEBHOOK_URL → missing_env", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx({ TELEGRAM_BOT_TOKEN: "token" });
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "missing_env");
    assert.ok(vr.missingEnv.includes("TELEGRAM_WEBHOOK_URL"));
  });

  test("missing TELEGRAM_ALLOWED_USER_IDS → missing_env", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_WEBHOOK_URL: "https://example.com",
      TELEGRAM_ALLOWED_CHAT_IDS: "123",
    });
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "missing_env");
    assert.ok(vr.missingEnv.includes("TELEGRAM_ALLOWED_USER_IDS"));
  });

  test("missing TELEGRAM_ALLOWED_CHAT_IDS → missing_env", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx({
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_WEBHOOK_URL: "https://example.com",
      TELEGRAM_ALLOWED_USER_IDS: "123",
    });
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "missing_env");
    assert.ok(vr.missingEnv.includes("TELEGRAM_ALLOWED_CHAT_IDS"));
  });
});

// ─── verify — getMe ──────────────────────────────────────────────────────────

describe("Telegram adapter — verify getMe", () => {
  test("getMe success → configured", async () => {
    const adapter = makeAdapter({
      getMe: async () => ({ success: true, message: "Bot verified: @testbot", data: { username: "testbot" } }),
      getWebhookInfo: async () => ({
        success: true,
        message: "Webhook is registered",
        data: { hasWebhook: true, webhookUrl: "https://worker.example.com/webhook" },
      }),
    });
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    assert.ok(vr.status === "configured" || vr.status === "degraded");
    assert.ok(vr.safeSummary.includes("@testbot") || vr.safeSummary.includes("testbot"));
  });

  test("getMe failure → error status", async () => {
    const adapter = makeAdapter({
      getMe: async () => ({ success: false, message: "getMe failed: HTTP 401" }),
    });
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "error");
    assert.ok(
      vr.safeSummary.includes("failed") || vr.safeSummary.includes("401"),
      "Error summary should describe the failure"
    );
  });

  test("getMe failure message never includes token", async () => {
    const adapter = makeAdapter({
      getMe: async () => ({ success: false, message: "getMe failed: HTTP 401" }),
    });
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    assert.ok(!vr.safeSummary.includes("test-token"), "Summary must not contain token");
    assert.ok(!vr.nextAction.includes("test-token"), "nextAction must not contain token");
  });

  test("no API call when ALLOW_TELEGRAM_PROVISION not set", async () => {
    let getMeCalled = false;
    const adapter = makeAdapter({
      getMe: async () => {
        getMeCalled = true;
        return { success: true, message: "Bot verified: @testbot" };
      },
    });
    const ctx = makeCtx({ ...baseEnv, ALLOW_TELEGRAM_PROVISION: "false" });
    await adapter.verify(ctx);
    assert.equal(getMeCalled, false, "getMe must not be called without gate");
  });
});

// ─── setWebhook ───────────────────────────────────────────────────────────────

describe("Telegram adapter — register_webhook", () => {
  test("webhook registration requires ALLOW_TELEGRAM_WEBHOOK_REGISTER gate", async () => {
    const adapter = makeAdapter();
    const env = { ...baseEnv, ALLOW_TELEGRAM_WEBHOOK_REGISTER: "false" };
    const ctx = makeCtx(env);
    const r = await adapter.apply(registerStep, ctx);
    assert.ok(r.status === "failed" || r.status === "gate_missing");
    assert.ok(r.message.includes("ALLOW_TELEGRAM_WEBHOOK_REGISTER"));
  });

  test("webhook registration success → applied", async () => {
    const adapter = makeAdapter({
      setWebhook: async () => ({ success: true, message: "Webhook registered successfully" }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(registerStep, ctx);
    assert.equal(r.status, "applied");
  });

  test("webhook registration without secret → degraded (security warning)", async () => {
    const adapter = makeAdapter({
      setWebhook: async () => ({ success: true, message: "Webhook registered" }),
    });
    const env = { ...baseEnv };
    delete (env as Record<string, string>)["TELEGRAM_WEBHOOK_SECRET"];
    const ctx = makeCtx(env);
    const r = await adapter.apply(registerStep, ctx);
    assert.ok(r.status === "degraded" || r.status === "applied");
    if (r.status === "degraded") {
      assert.ok(
        r.message.includes("secret") || r.message.includes("security"),
        "Degraded should mention missing secret"
      );
    }
  });

  test("webhook registration failure → safe error", async () => {
    const adapter = makeAdapter({
      setWebhook: async () => ({ success: false, message: "setWebhook failed: HTTP 400" }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(registerStep, ctx);
    assert.equal(r.status, "failed");
    assert.ok(!r.message.includes("test-token"), "Error must not contain bot token");
    assert.ok(!r.message.includes("test-secret"), "Error must not contain webhook secret");
  });

  test("missing webhook URL → failed", async () => {
    const adapter = makeAdapter();
    const env = { ...baseEnv };
    delete (env as Record<string, string>)["TELEGRAM_WEBHOOK_URL"];
    const ctx = makeCtx(env);
    const r = await adapter.apply(registerStep, ctx);
    assert.equal(r.status, "failed");
    assert.ok(r.message.includes("TELEGRAM_WEBHOOK_URL"));
  });
});

// ─── getWebhookInfo ───────────────────────────────────────────────────────────

describe("Telegram adapter — verify_webhook", () => {
  test("getWebhookInfo success with matching URL → verified", async () => {
    const adapter = makeAdapter({
      getWebhookInfo: async () => ({
        success: true,
        message: "Webhook is registered",
        data: { hasWebhook: true, webhookUrl: "https://worker.example.com/webhook" },
      }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(verifyWebhookStep, ctx);
    assert.equal(r.status, "verified");
  });

  test("getWebhookInfo URL mismatch → degraded", async () => {
    const adapter = makeAdapter({
      getWebhookInfo: async () => ({
        success: true,
        message: "Webhook is registered",
        data: { hasWebhook: true, webhookUrl: "https://old.example.com/webhook" },
      }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(verifyWebhookStep, ctx);
    assert.equal(r.status, "degraded");
    assert.ok(r.message.toLowerCase().includes("mismatch") || r.message.includes("match"));
  });

  test("getWebhookInfo no webhook → degraded", async () => {
    const adapter = makeAdapter({
      getWebhookInfo: async () => ({
        success: true,
        message: "No webhook configured",
        data: { hasWebhook: false, webhookUrl: "" },
      }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(verifyWebhookStep, ctx);
    assert.equal(r.status, "degraded");
  });

  test("getWebhookInfo failure → failed", async () => {
    const adapter = makeAdapter({
      getWebhookInfo: async () => ({ success: false, message: "getWebhookInfo failed: HTTP 500" }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(verifyWebhookStep, ctx);
    assert.equal(r.status, "failed");
  });
});

// ─── verify_bot ──────────────────────────────────────────────────────────────

describe("Telegram adapter — verify_bot apply", () => {
  test("getMe success → verified", async () => {
    const adapter = makeAdapter({
      getMe: async () => ({ success: true, message: "Bot verified: @testbot" }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(verifyBotStep, ctx);
    assert.equal(r.status, "verified");
  });

  test("getMe failure → failed", async () => {
    const adapter = makeAdapter({
      getMe: async () => ({ success: false, message: "getMe failed: HTTP 401" }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(verifyBotStep, ctx);
    assert.equal(r.status, "failed");
  });

  test("missing token → failed", async () => {
    const adapter = makeAdapter();
    const env = { ...baseEnv };
    delete (env as Record<string, string>)["TELEGRAM_BOT_TOKEN"];
    const ctx = makeCtx(env);
    const r = await adapter.apply(verifyBotStep, ctx);
    assert.equal(r.status, "failed");
  });
});

// ─── test_send ────────────────────────────────────────────────────────────────

describe("Telegram adapter — test_send", () => {
  test("test_send requires ALLOW_TELEGRAM_TEST_SEND gate", async () => {
    const adapter = makeAdapter();
    const env = { ...baseEnv, ALLOW_TELEGRAM_TEST_SEND: "false" };
    const ctx = makeCtx(env);
    const r = await adapter.apply(testSendStep, ctx);
    assert.ok(r.status === "failed" || r.status === "gate_missing");
    assert.ok(r.message.includes("ALLOW_TELEGRAM_TEST_SEND"));
  });

  test("test_send requires DEBUG_CHANNEL_ID or TEST_TELEGRAM_CHAT_ID", async () => {
    const adapter = makeAdapter();
    const env = { ...baseEnv };
    delete (env as Record<string, string>)["TEST_TELEGRAM_CHAT_ID"];
    delete (env as Record<string, string>)["DEBUG_CHANNEL_ID"];
    const ctx = makeCtx(env);
    const r = await adapter.apply(testSendStep, ctx);
    assert.equal(r.status, "failed");
    assert.ok(
      r.message.includes("TEST_TELEGRAM_CHAT_ID") || r.message.includes("DEBUG_CHANNEL_ID")
    );
  });

  test("test_send with DEBUG_CHANNEL_ID works", async () => {
    let sentToChat = "";
    let sentText = "";
    const adapter = makeAdapter({
      sendMessage: async (chatId, text) => {
        sentToChat = chatId;
        sentText = text;
        return { success: true, message: "Test message sent" };
      },
    });
    const env: Record<string, string> = { ...baseEnv };
    delete env["TEST_TELEGRAM_CHAT_ID"];
    env["DEBUG_CHANNEL_ID"] = "debug-chat-123";
    const ctx = makeCtx(env);
    const r = await adapter.apply(testSendStep, ctx);
    assert.equal(r.status, "applied");
    assert.equal(sentToChat, "debug-chat-123");
    assert.ok(sentText.length > 0, "A message must be sent");
    assert.ok(!sentText.includes("test-token"), "Message must not contain bot token");
  });

  test("test_send mock success returns applied", async () => {
    const adapter = makeAdapter({
      sendMessage: async () => ({ success: true, message: "Test message sent" }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(testSendStep, ctx);
    assert.equal(r.status, "applied");
  });

  test("test_send mock failure returns safe error", async () => {
    const adapter = makeAdapter({
      sendMessage: async () => ({ success: false, message: "sendMessage failed: HTTP 403" }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(testSendStep, ctx);
    assert.equal(r.status, "failed");
    assert.ok(!r.message.includes("test-token"), "Error must not contain bot token");
    assert.ok(!r.message.includes("test-secret"), "Error must not contain webhook secret");
  });
});

// ─── Production gate ──────────────────────────────────────────────────────────

describe("Telegram adapter — production gate", () => {
  test("production register_webhook step has productionGateRequired=true", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(baseEnv, "production");
    const steps = await adapter.plan(ctx);
    const step = steps.find((s) => s.action === "register_webhook");
    assert.ok(step?.productionGateRequired === true);
  });

  test("production test_send step has productionGateRequired=true", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(baseEnv, "production");
    const steps = await adapter.plan(ctx);
    const step = steps.find((s) => s.action === "test_send");
    assert.ok(step?.productionGateRequired === true);
  });
});

// ─── Secrets never in output ──────────────────────────────────────────────────

describe("Telegram adapter — secrets never in output", () => {
  test("verify() safeSummary never includes bot token", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    assert.ok(!vr.safeSummary.includes("test-token"), "safeSummary must not contain token");
    assert.ok(!vr.nextAction.includes("test-token"), "nextAction must not contain token");
  });

  test("apply register_webhook never includes webhook secret in result", async () => {
    const adapter = makeAdapter({
      setWebhook: async () => ({ success: true, message: "Webhook registered" }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(registerStep, ctx);
    assert.ok(!r.message.includes("test-secret"), "Result must not contain webhook secret");
    assert.ok(!r.message.includes("test-token"), "Result must not contain bot token");
  });

  test("apply test_send never includes bot token in result", async () => {
    const adapter = makeAdapter({
      sendMessage: async () => ({ success: true, message: "Test message sent" }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(testSendStep, ctx);
    assert.ok(!r.message.includes("test-token"), "Result must not contain bot token");
  });

  test("no real Telegram API URL appears in any output", async () => {
    const adapter = makeAdapter({
      getMe: async () => ({ success: true, message: "Bot verified: @testbot" }),
    });
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    // api.telegram.org URLs contain the token — they must never appear in summaries
    assert.ok(
      !vr.safeSummary.includes("api.telegram.org"),
      "API URL (containing token) must not appear in safeSummary"
    );
  });
});

// ─── plan() ───────────────────────────────────────────────────────────────────

describe("Telegram adapter — plan()", () => {
  test("plan returns verify_bot, register_webhook, verify_webhook, test_send", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    const actions = steps.map((s) => s.action);
    assert.ok(actions.includes("verify_bot"));
    assert.ok(actions.includes("register_webhook"));
    assert.ok(actions.includes("verify_webhook"));
    assert.ok(actions.includes("test_send"));
  });

  test("verify_bot and verify_webhook are read-only", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    const verifyBot = steps.find((s) => s.action === "verify_bot");
    const verifyWebhook = steps.find((s) => s.action === "verify_webhook");
    assert.equal(verifyBot?.mutation, false);
    assert.equal(verifyWebhook?.mutation, false);
  });

  test("register_webhook requires ALLOW_TELEGRAM_WEBHOOK_REGISTER gate", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    const step = steps.find((s) => s.action === "register_webhook");
    assert.equal(step?.requiredGate, "ALLOW_TELEGRAM_WEBHOOK_REGISTER");
  });

  test("test_send requires ALLOW_TELEGRAM_TEST_SEND gate", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    const step = steps.find((s) => s.action === "test_send");
    assert.equal(step?.requiredGate, "ALLOW_TELEGRAM_TEST_SEND");
  });

  test("all mutating steps have rollback instructions", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    for (const step of steps.filter((s) => s.mutation)) {
      assert.ok(step.rollback, `Step ${step.action} must have rollback instructions`);
    }
  });
});
