/**
 * tests/beezulbub-pack-verifier.test.ts
 *
 * Tests for pack verification (Phase 11D).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyPack, formatVerifyReport } from "../src/beezulbub/pack-verifier.js";

const MANIFEST_BASE = {
  packName: "test-pack",
  packVersion: "0.1.0",
  status: "skeleton",
  capabilities: ["test-cap"],
  source: { repo: "owner/repo", verdict: "DEVOUR" },
  generatedAt: "2026-01-01T00:00:00Z",
};

async function scaffoldFullPack(dir: string, name: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const packDir = path.join(dir, name);
  await mkdir(packDir, { recursive: true });
  await mkdir(path.join(packDir, "tests"), { recursive: true });
  await mkdir(path.join(packDir, "smoke"), { recursive: true });

  const manifest = { ...MANIFEST_BASE, packName: name, ...overrides };
  await writeFile(path.join(packDir, "pack.manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  await writeFile(path.join(packDir, "README.md"), `# ${name}\n`, "utf8");
  await writeFile(path.join(packDir, "adaptation-plan.md"), `# Adaptation Plan\n`, "utf8");
  await writeFile(path.join(packDir, "source-digest-summary.md"), `# Source Digest Summary\n`, "utf8");
  await writeFile(path.join(packDir, "rejected-poison.md"), `# Rejected Poison\n`, "utf8");
  await writeFile(path.join(packDir, "implementation-notes.md"), `# Implementation Notes\n`, "utf8");
  await writeFile(path.join(packDir, "tests", "pack.contract.test.ts"), `// contract tests\n`, "utf8");
  await writeFile(path.join(packDir, "smoke", "smoke-plan.md"), `# Smoke Plan\n`, "utf8");

  return packDir;
}

describe("pack-verifier", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pack-verifier-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("fails immediately if pack directory does not exist", async () => {
    const result = await verifyPack("/nonexistent/pack/path");
    assert.equal(result.status, "failed");
    const dirCheck = result.checks.find((c) => c.name === "pack_directory_exists");
    assert.ok(dirCheck);
    assert.equal(dirCheck!.passed, false);
  });

  it("passes full verification for a properly scaffolded pack", async () => {
    const packDir = await scaffoldFullPack(tmpDir, "full-pack");
    const result = await verifyPack(packDir);
    const failed = result.checks.filter((c) => !c.passed).map((c) => c.name);
    assert.deepEqual(failed, [], `Expected no failures, got: ${failed.join(", ")}`);
    assert.equal(result.status, "passed");
  });

  it("fails if manifest is missing", async () => {
    const packDir = path.join(tmpDir, "no-manifest-pack");
    await mkdir(packDir, { recursive: true });
    const result = await verifyPack(packDir);
    assert.equal(result.status, "failed");
    const check = result.checks.find((c) => c.name === "manifest_exists");
    assert.ok(check);
    assert.equal(check!.passed, false);
  });

  it("fails if required doc is missing", async () => {
    const packDir = await scaffoldFullPack(tmpDir, "missing-doc-pack");
    await rm(path.join(packDir, "adaptation-plan.md"));
    const result = await verifyPack(packDir);
    assert.equal(result.status, "failed");
    const check = result.checks.find((c) => c.name.includes("adaptation"));
    assert.ok(check);
    assert.equal(check!.passed, false);
  });

  it("fails if contract test is missing", async () => {
    const packDir = await scaffoldFullPack(tmpDir, "no-contract-test");
    await rm(path.join(packDir, "tests", "pack.contract.test.ts"));
    const result = await verifyPack(packDir);
    assert.equal(result.status, "failed");
    const check = result.checks.find((c) => c.name === "contract_test_exists");
    assert.ok(check);
    assert.equal(check!.passed, false);
  });

  it("fails if smoke plan is missing", async () => {
    const packDir = await scaffoldFullPack(tmpDir, "no-smoke-plan");
    await rm(path.join(packDir, "smoke", "smoke-plan.md"));
    const result = await verifyPack(packDir);
    assert.equal(result.status, "failed");
    const check = result.checks.find((c) => c.name === "smoke_plan_exists");
    assert.ok(check);
    assert.equal(check!.passed, false);
  });

  it("fails if .env file is present", async () => {
    const packDir = await scaffoldFullPack(tmpDir, "env-pack");
    await writeFile(path.join(packDir, ".env"), "SECRET=should-not-be-here", "utf8");
    const result = await verifyPack(packDir);
    assert.equal(result.status, "failed");
    const check = result.checks.find((c) => c.name.includes("_env"));
    assert.ok(check);
    assert.equal(check!.passed, false);
  });

  it("formatVerifyReport includes pass/fail summary", async () => {
    const packDir = await scaffoldFullPack(tmpDir, "report-pack");
    const result = await verifyPack(packDir);
    const report = formatVerifyReport(result);
    assert.ok(report.includes("Pack Verification"));
    assert.ok(report.includes("PASSED") || report.includes("FAILED"));
  });

  it("result.nextAction is a non-empty string", async () => {
    const packDir = await scaffoldFullPack(tmpDir, "next-action-pack");
    const result = await verifyPack(packDir);
    assert.ok(typeof result.nextAction === "string");
    assert.ok(result.nextAction.length > 0);
  });
});
