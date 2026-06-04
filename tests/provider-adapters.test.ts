/**
 * tests/provider-adapters.test.ts
 *
 * Tests that all provider adapters:
 * - implement the ProviderAdapter interface
 * - return ProviderVerificationResult from verify()
 * - never mutate real providers
 * - Phase 6: real adapters have no apply()
 * - mock adapter apply() returns safe result
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MockAdapter } from "../src/provisioning/adapters/mock.js";
import { GitHubAdapter } from "../src/provisioning/adapters/github.js";
import { SupabaseAdapter } from "../src/provisioning/adapters/supabase.js";
import { CloudflareAdapter } from "../src/provisioning/adapters/cloudflare.js";
import { TriggerAdapter } from "../src/provisioning/adapters/trigger.js";
import { TelegramAdapter } from "../src/provisioning/adapters/telegram.js";
import { OpenAIAdapter } from "../src/provisioning/adapters/openai.js";
import type { ProvisionContext, ProviderVerificationResult, ProviderAdapter } from "../src/provisioning/types.js";

const emptyCtx: ProvisionContext = {
  agentName: "test-agent",
  environment: "local",
  env: {},
};

const fullCtx: ProvisionContext = {
  agentName: "test-agent",
  environment: "staging",
  env: {
    // Phase 7A: GitHub
    GITHUB_TOKEN: "token",
    GITHUB_OWNER: "my-owner",
    GITHUB_ORG: "my-org",
    GITHUB_REPO_NAME: "my-repo",
    // Phase 7B: Cloudflare — include required vars but NOT CLOUDFLARE_WORKER_URL
    // so the health check is safely skipped in the generic verify() test.
    CLOUDFLARE_API_TOKEN: "cf-token",
    CLOUDFLARE_ACCOUNT_ID: "cf-account",
    CLOUDFLARE_WORKER_NAME: "cf-worker",
    // Other providers
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    TRIGGER_SECRET_KEY: "trigger-key",
    TRIGGER_PROJECT_ID: "trigger-project", // Phase 7E: needed for configured status
    TELEGRAM_BOT_TOKEN: "123:abc",
    TELEGRAM_WEBHOOK_URL: "https://example.com/webhook",
    TELEGRAM_WEBHOOK_SECRET: "tg-secret",  // Phase 7C: needed for configured (not degraded)
    TELEGRAM_ALLOWED_USER_IDS: "123456",   // Phase 7C required
    TELEGRAM_ALLOWED_CHAT_IDS: "123456",   // Phase 7C required
    OPENAI_API_KEY: "open-ai-key",
  },
};

function assertVerificationResult(result: ProviderVerificationResult, provider: string) {
  assert.equal(result.provider, provider);
  assert.ok(
    ["configured", "missing_env", "not_implemented", "error"].includes(result.status),
    `${provider} status must be one of configured/missing_env/not_implemented/error, got: ${result.status}`
  );
  assert.ok(Array.isArray(result.missingEnv), `${provider} missingEnv must be an array`);
  assert.ok(Array.isArray(result.supportedActions), `${provider} supportedActions must be an array`);
  assert.ok(Array.isArray(result.unsupportedActions), `${provider} unsupportedActions must be an array`);
  assert.ok(typeof result.nextAction === "string", `${provider} nextAction must be a string`);
  assert.ok(typeof result.safeSummary === "string", `${provider} safeSummary must be a string`);
  // safeSummary must not contain raw secret values
  assert.ok(
    !result.safeSummary.match(/sk-[A-Za-z0-9_-]{20,}/),
    `${provider} safeSummary must not contain API key patterns`
  );
}

// ─── All adapters: verify() ───────────────────────────────────────────────────

// Typed as ProviderAdapter so TypeScript sees the optional apply? from the interface.
const allAdapters: Array<{ name: string; adapter: ProviderAdapter }> = [
  { name: "github", adapter: new GitHubAdapter() },
  { name: "supabase", adapter: new SupabaseAdapter() },
  { name: "cloudflare", adapter: new CloudflareAdapter() },
  { name: "trigger", adapter: new TriggerAdapter() },
  { name: "telegram", adapter: new TelegramAdapter() },
  { name: "openai", adapter: new OpenAIAdapter() },
];

describe("adapter verify() with empty env", () => {
  for (const { name, adapter } of allAdapters) {
    test(`${name} verify() returns ProviderVerificationResult`, async () => {
      const result = await adapter.verify(emptyCtx);
      assertVerificationResult(result, name);
    });

    test(`${name} verify() shows missing_env when env is empty`, async () => {
      const result = await adapter.verify(emptyCtx);
      assert.equal(
        result.status,
        "missing_env",
        `${name} should show missing_env when env vars are absent`
      );
      assert.ok(result.missingEnv.length > 0, `${name} should list missing env vars`);
    });
  }
});

describe("adapter verify() with full env", () => {
  for (const { name, adapter } of allAdapters) {
    test(`${name} verify() shows configured when env is present`, async () => {
      const result = await adapter.verify(fullCtx);
      assert.equal(
        result.status,
        "configured",
        `${name} should be configured when all env vars are present`
      );
      assert.deepEqual(result.missingEnv, [], `${name} should have no missing env when configured`);
    });
  }
});

// ─── All adapters: plan() ─────────────────────────────────────────────────────

describe("adapter plan() steps are valid", () => {
  for (const { name, adapter } of allAdapters) {
    test(`${name} plan() returns at least one step`, async () => {
      const steps = await adapter.plan(emptyCtx);
      assert.ok(steps.length > 0, `${name} must return at least one planned step`);
    });

    test(`${name} plan() steps have required fields`, async () => {
      const steps = await adapter.plan(emptyCtx);
      for (const step of steps) {
        assert.ok(step.id, `${name} step must have id`);
        assert.equal(step.provider, name, `${name} step must have correct provider`);
        assert.ok(step.action, `${name} step must have action`);
        assert.ok(step.description, `${name} step must have description`);
        assert.ok(step.safeSummary, `${name} step must have safeSummary`);
      }
    });

    test(`${name} plan() mutating steps have requiredGate`, async () => {
      const steps = await adapter.plan(emptyCtx);
      const mutating = steps.filter((s) => s.mutation);
      for (const step of mutating) {
        assert.ok(
          step.requiredGate,
          `${name} mutating step ${step.id} must have requiredGate`
        );
      }
    });
  }
});

// ─── Phase 6 stubs: no apply() ───────────────────────────────────────────────
// GitHub and OpenAI are implemented in Phase 7A.
// Supabase, Cloudflare, Trigger, Telegram remain Phase 7B-7E stubs.

// Phase 7B: CloudflareAdapter now has apply().
// Phase 7C: TelegramAdapter now has apply().
// Phase 7D: SupabaseAdapter now has apply().
// Phase 7E: TriggerAdapter now has apply().
// All six real provider adapters are now implemented through Phase 7E.
// No remaining Phase 6 stubs.

describe("Phase 7A-7E adapters — all have apply() implemented", () => {
  test("GitHub adapter has apply() in Phase 7A", () => {
    const github = new GitHubAdapter();
    assert.ok(
      typeof github.apply === "function",
      "GitHub adapter must have apply() in Phase 7A"
    );
  });

  test("Cloudflare adapter has apply() in Phase 7B", () => {
    const cloudflare = new CloudflareAdapter();
    assert.ok(
      typeof cloudflare.apply === "function",
      "Cloudflare adapter must have apply() in Phase 7B"
    );
  });

  test("Telegram adapter has apply() in Phase 7C", () => {
    const telegram = new TelegramAdapter();
    assert.ok(
      typeof telegram.apply === "function",
      "Telegram adapter must have apply() in Phase 7C"
    );
  });

  test("Supabase adapter has apply() in Phase 7D", () => {
    const supabase = new SupabaseAdapter();
    assert.ok(
      typeof supabase.apply === "function",
      "Supabase adapter must have apply() in Phase 7D"
    );
  });

  test("Trigger adapter has apply() in Phase 7E", () => {
    const trigger = new TriggerAdapter();
    assert.ok(
      typeof trigger.apply === "function",
      "Trigger adapter must have apply() in Phase 7E"
    );
  });

  test("OpenAI adapter has no apply() (read-only verification only)", () => {
    // Cast to ProviderAdapter interface to access the optional apply property.
    const openai = new OpenAIAdapter() as ProviderAdapter;
    assert.equal(
      openai.apply,
      undefined,
      "OpenAI adapter is read-only — no apply() needed; verify() handles API call"
    );
  });
});

// ─── Mock adapter ─────────────────────────────────────────────────────────────

describe("MockAdapter", () => {
  test("mock adapter has apply() implementation", async () => {
    const mock = new MockAdapter("supabase");
    assert.ok(typeof mock.apply === "function", "MockAdapter must have apply()");
  });

  test("mock apply() returns applied status without real side effects", async () => {
    const mock = new MockAdapter("supabase");
    const steps = await mock.plan(emptyCtx);
    assert.ok(steps.length > 0);
    const result = await mock.apply!(steps[0]!, emptyCtx);
    assert.equal(result.status, "applied");
    assert.ok(
      result.message.includes("Mock") || result.message.includes("no real"),
      "Mock result must indicate no real provider was called"
    );
  });

  test("mock verify() always returns configured", async () => {
    const mock = new MockAdapter("cloudflare");
    const result = await mock.verify(emptyCtx);
    assert.equal(result.status, "configured");
  });

  test("mock adapter can be instantiated for any provider", () => {
    const providers = ["github", "supabase", "cloudflare", "trigger", "telegram", "openai"] as const;
    for (const provider of providers) {
      const mock = new MockAdapter(provider);
      assert.equal(mock.provider, provider);
    }
  });
});
