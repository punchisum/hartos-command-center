/**
 * tests/launch-readiness.test.ts
 *
 * Tests for the pre-launch readiness check.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkLaunchReadiness } from "../src/launch/readiness.js";
import { tmpdir } from "node:os";
import path from "node:path";

const emptyRoot = path.join(tmpdir(), "hartos-readiness-test-" + Date.now());

// ─── checkLaunchReadiness ────────────────────────────────────────────────────

describe("checkLaunchReadiness — missing env", () => {
  test("empty env → all global gates missing", async () => {
    const result = await checkLaunchReadiness({}, emptyRoot);
    assert.ok(result.missingGates.includes("ALLOW_AUTO_PROVISION"));
    assert.ok(result.missingGates.includes("CONFIRM_STAGING_PROVISION"));
  });

  test("empty env → all provider gates missing", async () => {
    const result = await checkLaunchReadiness({}, emptyRoot);
    assert.ok(result.missingGates.includes("ALLOW_GITHUB_PROVISION"));
    assert.ok(result.missingGates.includes("ALLOW_CLOUDFLARE_DEPLOY"));
    assert.ok(result.missingGates.includes("ALLOW_TELEGRAM_WEBHOOK_REGISTER"));
  });

  test("empty env → all providers show in warnings", async () => {
    const result = await checkLaunchReadiness({}, emptyRoot);
    assert.ok(result.warnings.some((w) => w.includes("supabase")));
    assert.ok(result.warnings.some((w) => w.includes("cloudflare") || w.includes("telegram")));
  });

  test("readiness result has correct shape", async () => {
    const result = await checkLaunchReadiness({}, emptyRoot);
    assert.ok(typeof result.ready === "boolean");
    assert.ok(Array.isArray(result.checks));
    assert.ok(Array.isArray(result.missingGates));
    assert.ok(Array.isArray(result.warnings));
    assert.ok(result.checks.length > 0);
  });
});

describe("checkLaunchReadiness — with gates open", () => {
  const fullGatedEnv: Record<string, string> = {
    ALLOW_AUTO_PROVISION: "true",
    CONFIRM_STAGING_PROVISION: "true",
    ALLOW_GITHUB_PROVISION: "true",
    ALLOW_OPENAI_VERIFY: "true",
    ALLOW_SUPABASE_PROVISION: "true",
    ALLOW_CLOUDFLARE_DEPLOY: "true",
    ALLOW_TELEGRAM_WEBHOOK_REGISTER: "true",
    ALLOW_TRIGGER_TASK_REGISTER: "true",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
    TELEGRAM_BOT_TOKEN: "123:abc",
    TELEGRAM_WEBHOOK_URL: "https://example.com",
    TRIGGER_SECRET_KEY: "key",
    CLOUDFLARE_WORKER_URL: "https://example.workers.dev",
    OPENAI_API_KEY: "key",
  };

  test("all gates open → missingGates is empty", async () => {
    const result = await checkLaunchReadiness(fullGatedEnv, emptyRoot);
    // Global and provider gates should be open
    const globalGates = ["ALLOW_AUTO_PROVISION", "CONFIRM_STAGING_PROVISION"];
    for (const gate of globalGates) {
      assert.ok(!result.missingGates.includes(gate), `Gate ${gate} should not be missing`);
    }
  });

  test("gate checks show as open", async () => {
    const result = await checkLaunchReadiness(fullGatedEnv, emptyRoot);
    const autoGate = result.checks.find((c) => c.name === "gate:ALLOW_AUTO_PROVISION");
    assert.ok(autoGate?.ok === true, "ALLOW_AUTO_PROVISION gate should be open");
  });
});

describe("checkLaunchReadiness — structural", () => {
  test("checks include gate:, provider:, and config: categories", async () => {
    const result = await checkLaunchReadiness({}, emptyRoot);
    const names = result.checks.map((c) => c.name);
    assert.ok(names.some((n) => n.startsWith("gate:")), "Must include gate checks");
    assert.ok(names.some((n) => n.startsWith("provider:")), "Must include provider checks");
    assert.ok(names.some((n) => n.startsWith("config:")), "Must include config checks");
  });

  test("each check has name, ok, and note", async () => {
    const result = await checkLaunchReadiness({}, emptyRoot);
    for (const check of result.checks) {
      assert.ok(typeof check.name === "string");
      assert.ok(typeof check.ok === "boolean");
      assert.ok(typeof check.note === "string");
    }
  });
});
