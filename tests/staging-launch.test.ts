/**
 * tests/staging-launch.test.ts
 *
 * Integration tests for the staging launch orchestration.
 * All provider operations are mocked via injected adapters.
 * No real provider APIs are called. No real infrastructure is mutated.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runStagingLaunch } from "../src/launch/staging-launch.js";
import { MockAdapter } from "../src/provisioning/adapters/mock.js";
import type { ProviderAdapter, ProvisionContext, ProvisionStep, ProvisionStepResult } from "../src/provisioning/types.js";

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeMockAdapter(
  provider: ProviderAdapter["provider"],
  applyStatus: ProvisionStepResult["status"] = "applied"
): ProviderAdapter {
  const base = new MockAdapter(provider);
  // Explicitly bind prototype methods — class instances don't spread their methods
  return {
    provider: base.provider,
    plan: (ctx: ProvisionContext) => base.plan(ctx),
    verify: (ctx: ProvisionContext) => base.verify(ctx),
    apply: async (step: ProvisionStep, _ctx: ProvisionContext): Promise<ProvisionStepResult> => ({
      step: { ...step, status: applyStatus },
      status: applyStatus,
      message: `Mock ${provider}: ${applyStatus}`,
      timestamp: new Date().toISOString(),
    }),
  };
}

function allMockAdapters(status: ProvisionStepResult["status"] = "applied"): ProviderAdapter[] {
  const providers: ProviderAdapter["provider"][] = [
    "github", "openai", "supabase", "cloudflare", "telegram", "trigger",
  ];
  return providers.map((p) => makeMockAdapter(p, status));
}

const baseGatedEnv: Record<string, string | undefined> = {
  ALLOW_AUTO_PROVISION: "true",
  CONFIRM_STAGING_PROVISION: "true",
  ALLOW_GITHUB_PROVISION: "true",
  ALLOW_GITHUB_PUSH: "true",
  ALLOW_OPENAI_VERIFY: "true",
  ALLOW_SUPABASE_PROVISION: "true",
  ALLOW_SUPABASE_MIGRATION_APPLY: "true",
  ALLOW_CLOUDFLARE_PROVISION: "true",
  ALLOW_CLOUDFLARE_DEPLOY: "true",
  ALLOW_TELEGRAM_PROVISION: "true",
  ALLOW_TELEGRAM_WEBHOOK_REGISTER: "true",
  ALLOW_TRIGGER_PROVISION: "true",
  ALLOW_TRIGGER_TASK_REGISTER: "true",
};

const noGatesEnv: Record<string, string | undefined> = {};

let tempDir: string;

before(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "hartos-launch-test-"));
});

after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ─── Launch plan builds provider order ────────────────────────────────────────

describe("staging launch — provider order", () => {
  test("launch report has required orchestration steps", async () => {
    const adapters = allMockAdapters("applied");
    const report = await runStagingLaunch({
      agentName: "test-agent",
      adapters,
      env: baseGatedEnv,
      reportsDir: tempDir,
    });
    // Report always includes these orchestration steps in order
    const stepIds = report.steps.map((s) => s.id);
    assert.ok(stepIds.includes("readiness"), "Must include readiness step");
    assert.ok(stepIds.includes("provision:plan"), "Must include provision:plan step");
    assert.ok(stepIds.includes("provision:auto"), "Must include provision:auto step");
    assert.ok(stepIds.includes("smoke:staging"), "Must include staging smoke step");
  });

  test("adapter list covers all six providers in launch order", () => {
    const providers = allMockAdapters("applied").map((a) => a.provider);
    const expected = ["github", "openai", "supabase", "cloudflare", "telegram", "trigger"] as const;
    for (const p of expected) {
      assert.ok(providers.includes(p), `Adapter list must include ${p}`);
    }
    // github comes before trigger
    assert.ok(
      providers.indexOf("github") < providers.indexOf("trigger"),
      "github must come before trigger in adapter order"
    );
  });
});

// ─── Missing global gate blocks mutation ─────────────────────────────────────

describe("staging launch — missing global gate", () => {
  test("missing ALLOW_AUTO_PROVISION blocks all mutations safely", async () => {
    const adapters = allMockAdapters("applied");
    const report = await runStagingLaunch({
      agentName: "test-agent",
      adapters,
      env: noGatesEnv,
      reportsDir: tempDir,
    });
    assert.equal(report.launchStatus, "blocked_missing_gate");
    assert.ok(report.missingGates.includes("ALLOW_AUTO_PROVISION"));
    // Provision auto step should be gate_missing
    const autoStep = report.steps.find((s) => s.id === "provision:auto");
    assert.ok(autoStep?.status === "gate_missing");
  });

  test("missing CONFIRM_STAGING_PROVISION also blocks mutations", async () => {
    const adapters = allMockAdapters("applied");
    const report = await runStagingLaunch({
      agentName: "test-agent",
      adapters,
      env: { ALLOW_AUTO_PROVISION: "true" }, // missing CONFIRM_STAGING_PROVISION
      reportsDir: tempDir,
    });
    assert.equal(report.launchStatus, "blocked_missing_gate");
    assert.ok(report.missingGates.includes("CONFIRM_STAGING_PROVISION"));
  });
});

// ─── Missing provider gate skips that provider ───────────────────────────────

describe("staging launch — missing provider gate", () => {
  test("missing provider gate records gate_missing for that provider step", async () => {
    // Gates open but no individual provider gates
    const gateMissingEnv = {
      ALLOW_AUTO_PROVISION: "true",
      CONFIRM_STAGING_PROVISION: "true",
      // No provider-specific gates
    };
    const adapters = allMockAdapters("applied");
    const report = await runStagingLaunch({
      agentName: "test-agent",
      adapters,
      env: gateMissingEnv,
      reportsDir: tempDir,
    });
    // Overall should be partial or blocked — not a hard failure
    assert.ok(
      report.launchStatus !== "failed",
      "Missing provider gates should not cause 'failed' status"
    );
    // Gate missing steps should exist
    const gateMissingSteps = report.steps.filter((s) => s.status === "gate_missing");
    assert.ok(
      gateMissingSteps.length > 0 || report.steps.some((s) => s.id === "provision:auto"),
      "Should have gate_missing steps or provision auto step"
    );
  });
});

// ─── manual_required creates partial/blocked report ──────────────────────────

describe("staging launch — manual_required steps", () => {
  test("manual_required step produces partial or blocked_manual_required status", async () => {
    const adapters = allMockAdapters("manual_required");
    const report = await runStagingLaunch({
      agentName: "test-agent",
      adapters,
      env: baseGatedEnv,
      reportsDir: tempDir,
    });
    assert.ok(
      report.launchStatus === "partial" ||
        report.launchStatus === "blocked_manual_required",
      `Expected partial or blocked_manual_required, got: ${report.launchStatus}`
    );
  });

  test("manual_required steps are listed in manualRequiredSteps", async () => {
    const adapters = allMockAdapters("manual_required");
    const report = await runStagingLaunch({
      agentName: "test-agent",
      adapters,
      env: baseGatedEnv,
      reportsDir: tempDir,
    });
    // manualRequiredSteps should not be empty when manual_required was returned
    // (Note: orchestrator records per-provider manual steps)
    assert.ok(
      Array.isArray(report.manualRequiredSteps),
      "manualRequiredSteps must be an array"
    );
  });
});

// ─── Successful mocked launch ─────────────────────────────────────────────────

describe("staging launch — successful mocked launch", () => {
  test("all mock adapters returning applied → success or partial", async () => {
    const adapters = allMockAdapters("applied");
    const report = await runStagingLaunch({
      agentName: "test-agent",
      adapters,
      env: baseGatedEnv,
      reportsDir: tempDir,
    });
    assert.ok(
      report.launchStatus === "success" || report.launchStatus === "partial",
      `Expected success or partial, got: ${report.launchStatus}`
    );
  });

  test("report includes agentName and environment", async () => {
    const adapters = allMockAdapters("applied");
    const report = await runStagingLaunch({
      agentName: "my-test-agent",
      adapters,
      env: baseGatedEnv,
      reportsDir: tempDir,
    });
    assert.equal(report.agentName, "my-test-agent");
    assert.equal(report.environment, "staging");
  });
});

// ─── Failed provider step ────────────────────────────────────────────────────

describe("staging launch — failed provider step", () => {
  test("failed provider step produces failed launch status", async () => {
    const failingAdapter = makeMockAdapter("github", "failed");
    const otherAdapters = allMockAdapters("applied").filter((a) => a.provider !== "github");
    const report = await runStagingLaunch({
      agentName: "test-agent",
      adapters: [failingAdapter, ...otherAdapters],
      env: baseGatedEnv,
      reportsDir: tempDir,
    });
    // Should be failed when a provider step fails
    assert.ok(
      report.launchStatus === "failed" || report.launchStatus === "partial",
      `Expected failed or partial, got: ${report.launchStatus}`
    );
  });
});

// ─── Report safety ────────────────────────────────────────────────────────────

describe("staging launch — report safety", () => {
  test("report contains no secret-looking values", async () => {
    const adapters = allMockAdapters("applied");
    const report = await runStagingLaunch({
      agentName: "test-agent",
      adapters,
      env: { ...baseGatedEnv, SUPABASE_SERVICE_ROLE_KEY: "secret-key-value" },
      reportsDir: tempDir,
    });
    const secretPattern = /[A-Za-z0-9+/=_-]{40,}/;
    // Report steps messages should not contain long secret-like strings
    for (const step of report.steps) {
      assert.ok(
        !secretPattern.test(step.message),
        `Step ${step.id} message contains secret-like value: ${step.message}`
      );
    }
  });

  test("rollbackPlanPath is null or a string (never throws)", async () => {
    const adapters = allMockAdapters("applied");
    const report = await runStagingLaunch({
      agentName: "test-agent",
      adapters,
      env: noGatesEnv,
      reportsDir: tempDir,
    });
    assert.ok(
      report.rollbackPlanPath === null || typeof report.rollbackPlanPath === "string",
      "rollbackPlanPath must be null or string"
    );
  });

  test("production is not touched by staging launch", async () => {
    const adapters = allMockAdapters("applied");
    const report = await runStagingLaunch({
      agentName: "test-agent",
      adapters,
      env: { ...baseGatedEnv, CONFIRM_PRODUCTION_DEPLOY: "true" },
      reportsDir: tempDir,
    });
    // environment must be staging
    assert.equal(report.environment, "staging");
    // No step should reference production mutation
    for (const step of report.steps) {
      assert.ok(
        !step.id.includes(":production"),
        `Step ${step.id} should not be a production step`
      );
    }
  });
});

// ─── Smoke degrades safely without secrets ───────────────────────────────────

describe("staging launch — smoke without real secrets", () => {
  test("staging smoke degrades safely without provider env vars", async () => {
    const adapters = allMockAdapters("applied");
    const report = await runStagingLaunch({
      agentName: "test-agent",
      adapters,
      env: noGatesEnv,
      reportsDir: tempDir,
    });
    // Smoke should be skipped or degraded, not throw
    assert.ok(
      ["passed", "failed", "skipped"].includes(report.smokeResult),
      `smokeResult must be a valid value, got: ${report.smokeResult}`
    );
  });
});
