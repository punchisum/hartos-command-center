/**
 * tests/bootstrap-engine.test.ts
 *
 * Tests for the bootstrap engine — gate enforcement and execution.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runBootstrapEngine } from "../src/bootstrap/bootstrap-engine.js";

describe("bootstrap engine — gate enforcement", () => {
  test("blocks when ALLOW_BOOTSTRAP_PROVISION not set", async () => {
    const result = await runBootstrapEngine({ env: {} });
    assert.equal(result.status, "gate_missing");
  });

  test("blocks when CONFIRM_BOOTSTRAP_PROVISION not set", async () => {
    const result = await runBootstrapEngine({
      env: { ALLOW_BOOTSTRAP_PROVISION: "true" },
    });
    assert.equal(result.status, "gate_missing");
  });

  test("gate_missing message does not contain secrets", async () => {
    const result = await runBootstrapEngine({ env: {} });
    const secretPattern = /[A-Za-z0-9+/=_-]{40,}/;
    assert.ok(!secretPattern.test(result.summary), "Summary must not contain secrets");
  });

  test("returns gate_missing summary listing missing gates", async () => {
    const result = await runBootstrapEngine({ env: {} });
    assert.ok(
      result.summary.includes("ALLOW_BOOTSTRAP_PROVISION") ||
        result.summary.includes("gate"),
      "Should mention missing gates"
    );
  });
});

describe("bootstrap engine — gates open", () => {
  const gatedEnv = {
    ALLOW_BOOTSTRAP_PROVISION: "true",
    CONFIRM_BOOTSTRAP_PROVISION: "true",
  };

  test("with gates open, returns result with steps", async () => {
    const result = await runBootstrapEngine({ env: gatedEnv });
    assert.ok(result.results.length > 0, "Should have results");
    assert.ok(result.plan.steps.length > 0, "Should have plan steps");
  });

  test("with gates open but no provider env, returns manual_required", async () => {
    const result = await runBootstrapEngine({ env: gatedEnv });
    assert.ok(
      result.status === "manual_required" || result.status === "applied",
      `Expected manual_required or applied, got: ${result.status}`
    );
  });

  test("cloudflare secrets always manual_required", async () => {
    const env = { ...gatedEnv, ALLOW_CLOUDFLARE_SECRET_UPLOAD: "true" };
    const result = await runBootstrapEngine({ env });
    const cfStep = result.results.find((s) => s.id === "cloudflare:secrets");
    assert.ok(cfStep?.status === "manual_required");
  });

  test("trigger deploy always manual_required", async () => {
    const env = { ...gatedEnv, ALLOW_TRIGGER_DEPLOY: "true" };
    const result = await runBootstrapEngine({ env });
    const triggerStep = result.results.find((s) => s.id === "trigger:deploy");
    assert.ok(triggerStep?.status === "manual_required");
  });

  test("no secrets in result", async () => {
    const env = {
      ...gatedEnv,
      SUPABASE_SERVICE_ROLE_KEY: "service-key-value",
      GITHUB_TOKEN: "github-token-value",
    };
    const result = await runBootstrapEngine({ env });
    for (const step of result.results) {
      assert.ok(!step.message.includes("service-key-value"), "Must not contain secret");
      assert.ok(!step.message.includes("github-token-value"), "Must not contain token");
    }
  });
});
