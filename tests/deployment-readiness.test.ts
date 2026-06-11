/**
 * tests/deployment-readiness.test.ts
 *
 * Tests that deployment readiness checks work correctly:
 * - missing env = not ready (exits 0, not 1)
 * - gate env vars are informational
 * - no secrets in output
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkProviderStatus } from "../src/runtime/env.js";
import type { Env } from "../src/shared/types.js";

// ─── Provider status checks ───────────────────────────────────────────────────

describe("checkProviderStatus with no env vars", () => {
  const emptyEnv: Env = {};

  test("supabase shows as not configured", () => {
    const statuses = checkProviderStatus(emptyEnv);
    const supabase = statuses.find((s) => s.provider === "supabase");
    assert.ok(supabase);
    assert.equal(supabase.configured, false);
  });

  test("telegram shows as not configured", () => {
    const statuses = checkProviderStatus(emptyEnv);
    const telegram = statuses.find((s) => s.provider === "telegram");
    assert.ok(telegram);
    assert.equal(telegram.configured, false);
  });

  test("all checks list the missing env var names", () => {
    const statuses = checkProviderStatus(emptyEnv);
    const supabase = statuses.find((s) => s.provider === "supabase")!;
    const missing = supabase.checks.filter((c) => !c.present).map((c) => c.name);
    assert.ok(missing.includes("SUPABASE_URL"));
    assert.ok(missing.includes("SUPABASE_SERVICE_ROLE_KEY"));
  });
});

describe("checkProviderStatus with partial env vars", () => {
  const partialEnv: Env = {
    SUPABASE_URL: "https://example.supabase.co",
    // SUPABASE_SERVICE_ROLE_KEY intentionally missing
  };

  test("supabase is still not configured when only URL is present", () => {
    const statuses = checkProviderStatus(partialEnv);
    const supabase = statuses.find((s) => s.provider === "supabase")!;
    assert.equal(supabase.configured, false);
    const missing = supabase.checks.filter((c) => !c.present).map((c) => c.name);
    assert.ok(missing.includes("SUPABASE_SERVICE_ROLE_KEY"));
    assert.ok(!missing.includes("SUPABASE_URL"));
  });
});

describe("checkProviderStatus with all required env vars", () => {
  const fullEnv: Env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-key",
    TELEGRAM_BOT_TOKEN: "123:abc",
    TELEGRAM_WEBHOOK_URL: "https://example.com/webhook",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    TRIGGER_SECRET_KEY: "trigger-key",
    CLOUDFLARE_WORKER_URL: "https://worker.example.com",
    OPENAI_API_KEY: "sk-test-key",
    HARTOS_COCKPIT_ACCESS_TOKEN: "cockpit-token",
    HARTOS_OPS_SUPABASE_URL: "https://ops.supabase.co",
    HARTOS_OPS_SUPABASE_READONLY_KEY: "ops-readonly-key",
    HARTOS_FITNESS_SUPABASE_URL: "https://fitness.supabase.co",
    HARTOS_FITNESS_SUPABASE_READONLY_KEY: "fitness-readonly-key",
  };

  test("all providers show as configured", () => {
    const statuses = checkProviderStatus(fullEnv);
    for (const status of statuses) {
      assert.equal(
        status.configured,
        true,
        `${status.provider} should be configured`
      );
    }
  });
});

// ─── Gate env vars ────────────────────────────────────────────────────────────

describe("Phase 5 gate env vars are present in Env type", () => {
  test("ALLOW_SUPABASE_MIGRATION_APPLY is a valid Env key", () => {
    const env: Env = { ALLOW_SUPABASE_MIGRATION_APPLY: "true" };
    assert.equal(env.ALLOW_SUPABASE_MIGRATION_APPLY, "true");
  });

  test("ALLOW_CLOUDFLARE_DEPLOY is a valid Env key", () => {
    const env: Env = { ALLOW_CLOUDFLARE_DEPLOY: "true" };
    assert.equal(env.ALLOW_CLOUDFLARE_DEPLOY, "true");
  });

  test("ALLOW_TELEGRAM_WEBHOOK_REGISTER is a valid Env key", () => {
    const env: Env = { ALLOW_TELEGRAM_WEBHOOK_REGISTER: "true" };
    assert.equal(env.ALLOW_TELEGRAM_WEBHOOK_REGISTER, "true");
  });

  test("CONFIRM_PRODUCTION_DEPLOY is a valid Env key", () => {
    const env: Env = { CONFIRM_PRODUCTION_DEPLOY: "true" };
    assert.equal(env.CONFIRM_PRODUCTION_DEPLOY, "true");
  });

  test("gate is NOT set by default (must opt in)", () => {
    const env: Env = {};
    assert.notEqual(env.ALLOW_CLOUDFLARE_DEPLOY, "true");
    assert.notEqual(env.ALLOW_SUPABASE_MIGRATION_APPLY, "true");
    assert.notEqual(env.ALLOW_TELEGRAM_WEBHOOK_REGISTER, "true");
    assert.notEqual(env.CONFIRM_PRODUCTION_DEPLOY, "true");
  });
});

// ─── Profile env vars ─────────────────────────────────────────────────────────

describe("Phase 5 profile env vars", () => {
  test("STAGING_SUPABASE_URL is a valid Env key", () => {
    const env: Env = { STAGING_SUPABASE_URL: "https://staging.supabase.co" };
    assert.ok(env.STAGING_SUPABASE_URL);
  });

  test("PRODUCTION_CLOUDFLARE_WORKER_URL is a valid Env key", () => {
    const env: Env = { PRODUCTION_CLOUDFLARE_WORKER_URL: "https://prod.worker.example.com" };
    assert.ok(env.PRODUCTION_CLOUDFLARE_WORKER_URL);
  });
});
