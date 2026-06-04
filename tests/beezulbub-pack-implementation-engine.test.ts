/**
 * tests/beezulbub-pack-implementation-engine.test.ts
 *
 * Tests for the pack implementation engine (Phase 11E).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { implementPack } from "../src/beezulbub/pack-implementation-engine.js";

const MANIFEST_BASE = {
  packName: "test-pack",
  packVersion: "0.1.0",
  status: "skeleton",
  capabilities: ["dashboard_layout"],
  source: { repo: "owner/repo", verdict: "DEVOUR" },
  generatedAt: "2026-01-01T00:00:00Z",
};

async function scaffoldSkeletonPack(dir: string, name: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const packDir = path.join(dir, name);
  await mkdir(packDir, { recursive: true });
  const manifest = { ...MANIFEST_BASE, packName: name, ...overrides };
  await writeFile(path.join(packDir, "pack.manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return packDir;
}

describe("pack-implementation-engine", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "impl-engine-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("blocks when both gates are missing", async () => {
    const packDir = await scaffoldSkeletonPack(tmpDir, "blocked-pack");
    const result = await implementPack({
      packPath: packDir,
      approveImplementation: false,
      allowPackImplement: false,
    });
    assert.equal(result.status, "blocked_missing_approval");
    assert.ok(result.message.includes("--approve-implementation"));
    assert.ok(result.message.includes("BEEZULBUB_ALLOW_PACK_IMPLEMENT"));
  });

  it("blocks when only env gate is missing", async () => {
    const packDir = await scaffoldSkeletonPack(tmpDir, "blocked-env-pack");
    const result = await implementPack({
      packPath: packDir,
      approveImplementation: true,
      allowPackImplement: false,
    });
    assert.equal(result.status, "blocked_missing_approval");
  });

  it("blocks when only CLI flag is missing", async () => {
    const packDir = await scaffoldSkeletonPack(tmpDir, "blocked-cli-pack");
    const result = await implementPack({
      packPath: packDir,
      approveImplementation: false,
      allowPackImplement: true,
    });
    assert.equal(result.status, "blocked_missing_approval");
  });

  it("blocks when pack status is not skeleton", async () => {
    const packDir = await scaffoldSkeletonPack(tmpDir, "wrong-status-pack", { status: "verified" });
    const result = await implementPack({
      packPath: packDir,
      approveImplementation: true,
      allowPackImplement: true,
    });
    assert.equal(result.status, "blocked_bad_status");
  });

  it("blocks when verdict is REJECT_POISON", async () => {
    const packDir = await scaffoldSkeletonPack(tmpDir, "reject-verdict-pack", {
      source: { repo: "owner/repo", verdict: "REJECT_POISON" },
    });
    const result = await implementPack({
      packPath: packDir,
      approveImplementation: true,
      allowPackImplement: true,
    });
    assert.equal(result.status, "blocked_bad_verdict");
  });

  it("blocks REFERENCE_ONLY verdict", async () => {
    const packDir = await scaffoldSkeletonPack(tmpDir, "ref-only-pack", {
      source: { repo: "owner/repo", verdict: "REFERENCE_ONLY" },
    });
    const result = await implementPack({
      packPath: packDir,
      approveImplementation: true,
      allowPackImplement: true,
    });
    assert.equal(result.status, "blocked_bad_verdict");
  });

  it("fails if manifest is missing", async () => {
    const packDir = path.join(tmpDir, "no-manifest-pack");
    await mkdir(packDir, { recursive: true });
    const result = await implementPack({
      packPath: packDir,
      approveImplementation: true,
      allowPackImplement: true,
    });
    assert.equal(result.status, "failed");
  });

  it("implements a DEVOUR skeleton pack successfully", async () => {
    const packDir = await scaffoldSkeletonPack(tmpDir, "devour-pack", {
      capabilities: ["dashboard_layout"],
    });
    const result = await implementPack({
      packPath: packDir,
      approveImplementation: true,
      allowPackImplement: true,
    });
    assert.equal(result.status, "implemented");
    assert.ok(result.filesGenerated.length > 0);
    assert.equal(result.capabilityType, "dashboard_layout");
  });

  it("updates manifest status to implementation_draft", async () => {
    const packDir = await scaffoldSkeletonPack(tmpDir, "status-update-pack", {
      capabilities: ["dashboard_layout"],
    });
    await implementPack({
      packPath: packDir,
      approveImplementation: true,
      allowPackImplement: true,
    });
    const { readFile } = await import("node:fs/promises");
    const manifest = JSON.parse(await readFile(path.join(packDir, "pack.manifest.json"), "utf8"));
    assert.equal(manifest.status, "implementation_draft");
  });

  it("generated files exist on disk", async () => {
    const packDir = await scaffoldSkeletonPack(tmpDir, "file-exists-pack", {
      capabilities: ["dashboard_layout"],
    });
    const result = await implementPack({
      packPath: packDir,
      approveImplementation: true,
      allowPackImplement: true,
    });
    assert.equal(result.status, "implemented");
    for (const relPath of result.filesGenerated) {
      assert.ok(existsSync(path.join(packDir, relPath)), `File must exist: ${relPath}`);
    }
  });

  it("implements PARTIAL_DEVOUR packs", async () => {
    const packDir = await scaffoldSkeletonPack(tmpDir, "partial-devour-pack", {
      source: { repo: "owner/repo", verdict: "PARTIAL_DEVOUR" },
      capabilities: ["receipt_ocr"],
    });
    const result = await implementPack({
      packPath: packDir,
      approveImplementation: true,
      allowPackImplement: true,
    });
    assert.equal(result.status, "implemented");
    assert.equal(result.capabilityType, "receipt_ocr");
  });
});
