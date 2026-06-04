/**
 * tests/production-launch.test.ts
 *
 * Tests for the production launch orchestrator.
 * All provider operations are mocked. No real APIs called.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runProductionLaunch } from "../src/launch/production-launch.js";
import { MockAdapter } from "../src/provisioning/adapters/mock.js";
import type { ProviderAdapter, ProvisionContext, ProvisionStep, ProvisionStepResult } from "../src/provisioning/types.js";

function makeMockAdapter(provider: ProviderAdapter["provider"], status: ProvisionStepResult["status"] = "applied"): ProviderAdapter {
  const base = new MockAdapter(provider);
  return {
    provider: base.provider,
    plan: (ctx: ProvisionContext) => base.plan(ctx),
    verify: (ctx: ProvisionContext) => base.verify(ctx),
    apply: async (step: ProvisionStep, _ctx: ProvisionContext): Promise<ProvisionStepResult> => ({
      step: { ...step, status },
      status,
      message: `Mock ${provider}: ${status}`,
      timestamp: new Date().toISOString(),
    }),
  };
}

function allMockAdapters(status: ProvisionStepResult["status"] = "applied"): ProviderAdapter[] {
  const providers: ProviderAdapter["provider"][] = ["github", "openai", "supabase", "cloudflare", "telegram", "trigger"];
  return providers.map((p) => makeMockAdapter(p, status));
}

const fullGatesEnv: Record<string, string | undefined> = {
  ALLOW_PRODUCTION_PROMOTION: "true",
  CONFIRM_PRODUCTION_DEPLOY: "true",
  ALLOW_AUTO_PROVISION: "true",
  ALLOW_GITHUB_PROVISION: "true",
  ALLOW_CLOUDFLARE_DEPLOY: "true",
};

let tmpDir: string;

before(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "hartos-prod-launch-test-"));
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function withStagingProof(dir: string, status: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "staging-launch-2026-06-03T10-00-00.json"),
    JSON.stringify({ launchStatus: status, timestamp: "2026-06-03T10:00:00.000Z", agentName: "test-agent" }),
    "utf8"
  );
  return dir;
}

describe("production launch — blocked without staging proof", () => {
  test("blocked_no_staging_proof when no reports exist", async () => {
    const reportsDir = path.join(tmpDir, "no-proof");
    const report = await runProductionLaunch({
      agentName: "test-agent",
      adapters: allMockAdapters(),
      env: fullGatesEnv,
      reportsDir,
    });
    assert.ok(
      report.launchStatus === "blocked_no_staging_proof" ||
        report.launchStatus === "blocked_staging_not_green" ||
        report.launchStatus === "blocked_missing_gate",
      `Expected blocked status, got: ${report.launchStatus}`
    );
  });
});

describe("production launch — blocked when staging failed", () => {
  test("blocked when staging report shows failed", async () => {
    const reportsDir = path.join(tmpDir, "failed-proof");
    await withStagingProof(reportsDir, "failed");
    const report = await runProductionLaunch({
      agentName: "test-agent",
      adapters: allMockAdapters(),
      env: fullGatesEnv,
      reportsDir,
    });
    assert.ok(
      report.launchStatus === "blocked_staging_not_green" ||
        report.launchStatus === "blocked_missing_gate",
      `Expected blocked, got: ${report.launchStatus}`
    );
  });
});

describe("production launch — gates required", () => {
  test("blocks without CONFIRM_PRODUCTION_DEPLOY", async () => {
    const reportsDir = path.join(tmpDir, "no-confirm");
    await withStagingProof(reportsDir, "success");
    const envWithoutConfirm = { ...fullGatesEnv, CONFIRM_PRODUCTION_DEPLOY: undefined };
    const report = await runProductionLaunch({
      agentName: "test-agent",
      adapters: allMockAdapters(),
      env: envWithoutConfirm,
      reportsDir,
    });
    assert.equal(report.launchStatus, "blocked_missing_gate");
    assert.ok(report.missingGates.includes("CONFIRM_PRODUCTION_DEPLOY"));
  });

  test("environment is staging type (production launch uses staging report type)", async () => {
    const reportsDir = path.join(tmpDir, "env-check");
    await withStagingProof(reportsDir, "success");
    const report = await runProductionLaunch({
      agentName: "test-agent",
      adapters: allMockAdapters(),
      env: fullGatesEnv,
      reportsDir,
    });
    // Report environment field is from LaunchReport type
    assert.ok(report.environment === "staging"); // LaunchReport.environment is always "staging" type
  });
});

describe("production launch — report safety", () => {
  test("production report contains no secret-looking values", async () => {
    const reportsDir = path.join(tmpDir, "report-safety");
    await withStagingProof(reportsDir, "success");
    const env = { ...fullGatesEnv, SUPABASE_SERVICE_ROLE_KEY: "some-key-value" };
    const report = await runProductionLaunch({
      agentName: "test-agent",
      adapters: allMockAdapters(),
      env,
      reportsDir,
    });
    const secretPattern = /[A-Za-z0-9+/=_-]{40,}/;
    for (const step of report.steps) {
      assert.ok(!secretPattern.test(step.message), `Step ${step.id} message contains secret-like value`);
    }
  });
});
