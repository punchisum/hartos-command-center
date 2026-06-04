/**
 * tests/beezulbub-pack-promotion.test.ts
 *
 * Tests for pack promotion (Phase 11D).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promotepack } from "../src/beezulbub/pack-promotion.js";

async function scaffoldPack(
  dir: string,
  name: string,
  status: string = "skeleton",
  verdict: string = "DEVOUR"
): Promise<string> {
  const packDir = path.join(dir, name);
  await mkdir(packDir, { recursive: true });
  await mkdir(path.join(packDir, "tests"), { recursive: true });
  await mkdir(path.join(packDir, "smoke"), { recursive: true });

  const manifest = {
    packName: name,
    packVersion: "0.1.0",
    status,
    capabilities: [`${name}-cap`],
    source: { repo: "owner/repo", verdict },
    generatedAt: "2026-01-01T00:00:00Z",
  };
  await writeFile(path.join(packDir, "pack.manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  await writeFile(path.join(packDir, "README.md"), `# ${name}\n`, "utf8");
  await writeFile(path.join(packDir, "adaptation-plan.md"), `# Adaptation Plan\n`, "utf8");
  await writeFile(path.join(packDir, "source-digest-summary.md"), `# Digest\n`, "utf8");
  await writeFile(path.join(packDir, "rejected-poison.md"), `# Poison\n`, "utf8");
  await writeFile(path.join(packDir, "implementation-notes.md"), `# Notes\n`, "utf8");
  await writeFile(path.join(packDir, "tests", "pack.contract.test.ts"), `// tests\n`, "utf8");
  await writeFile(path.join(packDir, "smoke", "smoke-plan.md"), `# Smoke\n`, "utf8");

  return packDir;
}

describe("pack-promotion", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pack-promotion-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("blocks when approval flags are missing", async () => {
    const packDir = await scaffoldPack(tmpDir, "blocked-pack");
    const result = await promotepack({
      packPath: packDir,
      targetStatus: "verified",
      approvePromote: false,
      allowPackPromote: false,
    });
    assert.equal(result.status, "blocked_missing_approval");
  });

  it("blocks when only env gate is missing", async () => {
    const packDir = await scaffoldPack(tmpDir, "blocked-env-pack");
    const result = await promotepack({
      packPath: packDir,
      targetStatus: "verified",
      approvePromote: true,
      allowPackPromote: false,
    });
    assert.equal(result.status, "blocked_missing_approval");
  });

  it("blocks REJECT_POISON verdict packs", async () => {
    const packDir = await scaffoldPack(tmpDir, "poison-pack", "skeleton", "REJECT_POISON");
    const result = await promotepack({
      packPath: packDir,
      targetStatus: "verified",
      approvePromote: true,
      allowPackPromote: true,
    });
    assert.equal(result.status, "blocked_bad_verdict");
  });

  it("blocks REFERENCE_ONLY from reaching available (via reference_only status)", async () => {
    // reference_only packs have status="reference_only", not "verified"
    const packDir = await scaffoldPack(tmpDir, "ref-pack", "reference_only", "REFERENCE_ONLY");
    const result = await promotepack({
      packPath: packDir,
      targetStatus: "available",
      approvePromote: true,
      allowPackPromote: true,
    });
    assert.equal(result.status, "blocked_bad_verdict");
  });

  it("promotes verified → available when all checks pass", async () => {
    const packDir = await scaffoldPack(tmpDir, "promote-to-available", "verified", "DEVOUR");
    const result = await promotepack({
      packPath: packDir,
      targetStatus: "available",
      approvePromote: true,
      allowPackPromote: true,
    });
    assert.equal(result.status, "promoted");
    assert.equal(result.toStatus, "available");
  });

  it("promotes implementation_draft → verified when pack passes verification", async () => {
    // Lifecycle: skeleton → implementation_draft → verified
    const packDir = await scaffoldPack(tmpDir, "promote-to-verified", "implementation_draft", "DEVOUR");
    const result = await promotepack({
      packPath: packDir,
      targetStatus: "verified",
      approvePromote: true,
      allowPackPromote: true,
    });
    assert.equal(result.status, "promoted");
    assert.equal(result.toStatus, "verified");
  });

  it("result has packName and fromStatus", async () => {
    const packDir = await scaffoldPack(tmpDir, "result-fields-pack", "verified");
    const result = await promotepack({
      packPath: packDir,
      targetStatus: "available",
      approvePromote: true,
      allowPackPromote: true,
    });
    assert.ok(typeof result.packName === "string");
    assert.ok(typeof result.fromStatus === "string");
    assert.ok(typeof result.message === "string");
  });
});
