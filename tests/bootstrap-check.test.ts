/**
 * tests/bootstrap-check.test.ts
 *
 * Tests for bootstrap readiness check.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkBootstrap } from "../src/bootstrap/bootstrap-check.js";

describe("checkBootstrap — missing env", () => {
  test("empty env → all providers missing", async () => {
    const plan = await checkBootstrap({});
    const missingEnvSteps = plan.steps.filter((s) => s.status === "missing_env");
    assert.ok(missingEnvSteps.length > 0, "Should have missing_env steps");
  });

  test("empty env → missing gates", async () => {
    const plan = await checkBootstrap({});
    assert.ok(plan.missingGates.includes("ALLOW_BOOTSTRAP_PROVISION"));
    assert.ok(plan.missingGates.includes("CONFIRM_BOOTSTRAP_PROVISION"));
  });

  test("returns BootstrapPlan shape", async () => {
    const plan = await checkBootstrap({});
    assert.ok(typeof plan.agentName === "string");
    assert.ok(typeof plan.timestamp === "string");
    assert.ok(Array.isArray(plan.steps));
    assert.ok(Array.isArray(plan.missingGates));
    assert.ok(Array.isArray(plan.missingEnv));
    assert.ok(typeof plan.summary === "string");
  });

  test("plan with supabase env shows supabase as ready", async () => {
    const plan = await checkBootstrap({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "key",
    });
    const supabaseScope = plan.steps.find((s) => s.id === "supabase:scope");
    assert.ok(supabaseScope?.status === "ready");
  });

  test("cloudflare secrets step is always manual_required", async () => {
    const plan = await checkBootstrap({
      CLOUDFLARE_API_TOKEN: "token",
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_WORKER_NAME: "worker",
    });
    const cfSecretsStep = plan.steps.find((s) => s.id === "cloudflare:secrets");
    assert.ok(cfSecretsStep?.status === "manual_required");
    assert.ok(cfSecretsStep?.manualRequired === true);
  });

  test("trigger deploy step is always manual_required", async () => {
    const plan = await checkBootstrap({
      TRIGGER_SECRET_KEY: "key",
      TRIGGER_PROJECT_ID: "proj",
    });
    const triggerStep = plan.steps.find((s) => s.id === "trigger:deploy");
    assert.ok(triggerStep?.status === "manual_required");
  });

  test("manual steps include commands", async () => {
    const plan = await checkBootstrap({});
    const manualSteps = plan.steps.filter((s) => s.status === "manual_required");
    for (const step of manualSteps) {
      assert.ok(Array.isArray(step.manualCommands), `Step ${step.id} should have manualCommands`);
    }
  });

  test("no secrets in plan summary or step messages", async () => {
    const plan = await checkBootstrap({ SUPABASE_SERVICE_ROLE_KEY: "secret-value-here" });
    const secretPattern = /[A-Za-z0-9+/=_-]{40,}/;
    assert.ok(!secretPattern.test(plan.summary), "Summary must not contain secrets");
    for (const step of plan.steps) {
      assert.ok(!step.message.includes("secret-value-here"), `Step ${step.id} must not contain secret`);
    }
  });
});
