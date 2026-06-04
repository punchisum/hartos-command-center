/**
 * tests/production-promotion.test.ts
 *
 * Tests for production promotion gate logic and staging proof checks.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkProductionPromotionGates, readLatestStagingProof } from "../src/launch/promotion.js";

let tmpDir: string;

before(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "hartos-prod-promo-test-"));
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const allGatesEnv: Record<string, string> = {
  ALLOW_PRODUCTION_PROMOTION: "true",
  CONFIRM_PRODUCTION_DEPLOY: "true",
  ALLOW_AUTO_PROVISION: "true",
};

// ─── Staging proof reading ────────────────────────────────────────────────────

describe("readLatestStagingProof", () => {
  test("returns found=false when no reports dir", async () => {
    const proof = await readLatestStagingProof(path.join(tmpDir, "nonexistent"));
    assert.equal(proof.found, false);
    assert.equal(proof.status, null);
  });

  test("returns found=false when no staging reports", async () => {
    const emptyDir = path.join(tmpDir, "empty-reports");
    await mkdir(emptyDir, { recursive: true });
    const proof = await readLatestStagingProof(emptyDir);
    assert.equal(proof.found, false);
  });

  test("reads latest staging report", async () => {
    const reportsDir = path.join(tmpDir, "proof-reports");
    await mkdir(reportsDir, { recursive: true });
    const report = { launchStatus: "success", timestamp: "2026-06-03T10:00:00.000Z", agentName: "test-agent" };
    await writeFile(path.join(reportsDir, "staging-launch-2026-06-03T10-00-00.json"), JSON.stringify(report), "utf8");
    const proof = await readLatestStagingProof(reportsDir);
    assert.equal(proof.found, true);
    assert.equal(proof.status, "success");
    assert.equal(proof.agentName, "test-agent");
  });

  test("reads most recent of multiple reports", async () => {
    const reportsDir = path.join(tmpDir, "multi-proof-reports");
    await mkdir(reportsDir, { recursive: true });
    await writeFile(path.join(reportsDir, "staging-launch-2026-06-01T10-00-00.json"),
      JSON.stringify({ launchStatus: "failed", timestamp: "2026-06-01T10:00:00.000Z" }), "utf8");
    await writeFile(path.join(reportsDir, "staging-launch-2026-06-03T10-00-00.json"),
      JSON.stringify({ launchStatus: "success", timestamp: "2026-06-03T10:00:00.000Z" }), "utf8");
    const proof = await readLatestStagingProof(reportsDir);
    assert.equal(proof.status, "success");
  });
});

// ─── Promotion gate checks ────────────────────────────────────────────────────

describe("checkProductionPromotionGates — missing gates", () => {
  test("blocks when ALLOW_PRODUCTION_PROMOTION missing", async () => {
    const env = { CONFIRM_PRODUCTION_DEPLOY: "true", ALLOW_AUTO_PROVISION: "true" };
    const result = await checkProductionPromotionGates(env, tmpDir);
    assert.equal(result.allowed, false);
    assert.ok(result.missingGates.includes("ALLOW_PRODUCTION_PROMOTION"));
  });

  test("blocks when CONFIRM_PRODUCTION_DEPLOY missing", async () => {
    const env = { ALLOW_PRODUCTION_PROMOTION: "true", ALLOW_AUTO_PROVISION: "true" };
    const result = await checkProductionPromotionGates(env, tmpDir);
    assert.equal(result.allowed, false);
    assert.ok(result.missingGates.includes("CONFIRM_PRODUCTION_DEPLOY"));
  });

  test("blocks when ALLOW_AUTO_PROVISION missing", async () => {
    const env = { ALLOW_PRODUCTION_PROMOTION: "true", CONFIRM_PRODUCTION_DEPLOY: "true" };
    const result = await checkProductionPromotionGates(env, tmpDir);
    assert.equal(result.allowed, false);
    assert.ok(result.missingGates.includes("ALLOW_AUTO_PROVISION"));
  });
});

describe("checkProductionPromotionGates — staging proof", () => {
  test("blocks when no staging report exists", async () => {
    const reportsDir = path.join(tmpDir, "no-staging");
    const result = await checkProductionPromotionGates(allGatesEnv, reportsDir);
    assert.equal(result.allowed, false);
    assert.ok(result.blockedReason?.includes("staging") || result.blockedReason?.includes("No staging"));
  });

  test("blocks when staging report failed", async () => {
    const reportsDir = path.join(tmpDir, "failed-staging");
    await mkdir(reportsDir, { recursive: true });
    await writeFile(path.join(reportsDir, "staging-launch-2026-06-03T10-00-00.json"),
      JSON.stringify({ launchStatus: "failed", timestamp: "2026-06-03T10:00:00.000Z" }), "utf8");
    const result = await checkProductionPromotionGates(allGatesEnv, reportsDir);
    assert.equal(result.allowed, false);
    assert.ok(result.blockedReason?.includes("failed") || result.blockedReason?.includes("staging"));
  });

  test("blocks when staging was partial and no override", async () => {
    const reportsDir = path.join(tmpDir, "partial-staging");
    await mkdir(reportsDir, { recursive: true });
    await writeFile(path.join(reportsDir, "staging-launch-2026-06-03T10-00-00.json"),
      JSON.stringify({ launchStatus: "partial", timestamp: "2026-06-03T10:00:00.000Z" }), "utf8");
    const result = await checkProductionPromotionGates(allGatesEnv, reportsDir);
    assert.equal(result.allowed, false);
    assert.ok(result.blockedReason?.includes("partial"));
  });

  test("allows when staging was partial and ALLOW_PARTIAL_STAGING_PROMOTION=true", async () => {
    const reportsDir = path.join(tmpDir, "partial-override-staging");
    await mkdir(reportsDir, { recursive: true });
    await writeFile(path.join(reportsDir, "staging-launch-2026-06-03T10-00-00.json"),
      JSON.stringify({ launchStatus: "partial", timestamp: "2026-06-03T10:00:00.000Z" }), "utf8");
    const env = { ...allGatesEnv, ALLOW_PARTIAL_STAGING_PROMOTION: "true" };
    const result = await checkProductionPromotionGates(env, reportsDir);
    assert.equal(result.allowed, true);
  });

  test("allows when staging was success and all gates open", async () => {
    const reportsDir = path.join(tmpDir, "green-staging");
    await mkdir(reportsDir, { recursive: true });
    await writeFile(path.join(reportsDir, "staging-launch-2026-06-03T10-00-00.json"),
      JSON.stringify({ launchStatus: "success", timestamp: "2026-06-03T10:00:00.000Z" }), "utf8");
    const result = await checkProductionPromotionGates(allGatesEnv, reportsDir);
    assert.equal(result.allowed, true);
    assert.equal(result.blockedReason, null);
  });
});
