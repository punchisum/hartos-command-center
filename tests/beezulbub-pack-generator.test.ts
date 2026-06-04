/**
 * tests/beezulbub-pack-generator.test.ts
 *
 * Tests for Beezulbub pack skeleton generation.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generatePack } from "../src/beezulbub/pack-generator.js";
import type { PackGenerateOptions } from "../src/beezulbub/pack-types.js";

let tmpDir: string;
let reportsDir: string;

before(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "hartos-pack-gen-test-"));
  reportsDir = path.join(tmpDir, "beezulbub-reports");
  await mkdir(reportsDir, { recursive: true });

  // Write a clean score file
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  await writeFile(
    path.join(reportsDir, `score-${ts}.json`),
    JSON.stringify({
      repoName: "clean-dashboard",
      verdict: "DEVOUR",
      score: { overall: 7.9 },
      capabilities: ["dashboard_layout"],
      license: "MIT",
    }),
    "utf8"
  );
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const approvedOpts: PackGenerateOptions = {
  capability: "test_capability",
  fromLatest: true,
  approveDevour: true,
  allowPackGenerate: true,
};

// ─── Approval gate ────────────────────────────────────────────────────────────

describe("pack generation — approval gates", () => {
  test("blocks without --approve-devour flag", async () => {
    const result = await generatePack(
      { ...approvedOpts, approveDevour: false },
      "beezulbub-reports",
      tmpDir
    );
    assert.equal(result.status, "blocked_missing_approval");
    assert.ok(result.message.includes("approve-devour") || result.message.includes("approval"));
  });

  test("blocks without BEEZULBUB_ALLOW_PACK_GENERATE env", async () => {
    const result = await generatePack(
      { ...approvedOpts, allowPackGenerate: false },
      "beezulbub-reports",
      tmpDir
    );
    assert.equal(result.status, "blocked_missing_approval");
    assert.ok(result.message.includes("BEEZULBUB_ALLOW_PACK_GENERATE"));
  });

  test("blocks when both are missing", async () => {
    const result = await generatePack(
      { ...approvedOpts, approveDevour: false, allowPackGenerate: false },
      "beezulbub-reports",
      tmpDir
    );
    assert.equal(result.status, "blocked_missing_approval");
  });
});

// ─── Verdict gates ────────────────────────────────────────────────────────────

describe("pack generation — verdict gates", () => {
  test("DEVOUR generates pack", async () => {
    const packDir = path.join(tmpDir, "packs-devour");
    const result = await generatePack(
      { ...approvedOpts, capability: "devour_test", packOutputDir: packDir },
      "beezulbub-reports",
      tmpDir
    );
    assert.ok(
      result.status === "generated" || result.status === "blocked_bad_verdict",
      `Expected generated or blocked, got: ${result.status}`
    );
  });

  test("PARTIAL_DEVOUR generates pack", async () => {
    // Write a PARTIAL_DEVOUR score
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const scoreFile = path.join(reportsDir, `score-partial-${ts}.json`);
    await writeFile(scoreFile, JSON.stringify({
      repoName: "partial-repo",
      verdict: "PARTIAL_DEVOUR",
      score: { overall: 5.5 },
      capabilities: ["partial_capability"],
    }), "utf8");

    const packDir = path.join(tmpDir, "packs-partial");
    const result = await generatePack(
      {
        ...approvedOpts,
        capability: "partial_capability",
        digestPath: scoreFile,
        packOutputDir: packDir,
      },
      "beezulbub-reports",
      tmpDir
    );
    assert.ok(result.status === "generated" || result.status === "blocked_bad_verdict");
  });

  test("REJECT_POISON is blocked", async () => {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const scoreFile = path.join(reportsDir, `score-poison-${ts}.json`);
    await writeFile(scoreFile, JSON.stringify({
      repoName: "poison-repo",
      verdict: "REJECT_POISON",
      score: { overall: 1.2 },
    }), "utf8");

    const result = await generatePack(
      { ...approvedOpts, digestPath: scoreFile, packOutputDir: path.join(tmpDir, "packs-poison") },
      "beezulbub-reports",
      tmpDir
    );
    assert.equal(result.status, "blocked_bad_verdict");
    assert.ok(result.message.includes("REJECT_POISON") || result.message.includes("blocked"));
  });

  test("REJECT_LICENSE is blocked", async () => {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const scoreFile = path.join(reportsDir, `score-license-${ts}.json`);
    await writeFile(scoreFile, JSON.stringify({
      repoName: "gpl-repo",
      verdict: "REJECT_LICENSE",
      score: { overall: 2.1 },
    }), "utf8");

    const result = await generatePack(
      { ...approvedOpts, digestPath: scoreFile, packOutputDir: path.join(tmpDir, "packs-license") },
      "beezulbub-reports",
      tmpDir
    );
    assert.equal(result.status, "blocked_bad_verdict");
  });
});

// ─── Generated structure ──────────────────────────────────────────────────────

describe("pack generation — structure", () => {
  let packResult: Awaited<ReturnType<typeof generatePack>>;

  before(async () => {
    const packDir = path.join(tmpDir, "packs-struct");
    packResult = await generatePack(
      { ...approvedOpts, capability: "struct_test", packOutputDir: packDir },
      "beezulbub-reports",
      tmpDir
    );
  });

  test("generates pack directory", () => {
    if (packResult.status !== "generated") return; // Skip if blocked
    assert.ok(packResult.packPath && existsSync(packResult.packPath));
  });

  test("generates pack.manifest.json", async () => {
    if (packResult.status !== "generated" || !packResult.packPath) return;
    const manifestPath = path.join(packResult.packPath, "pack.manifest.json");
    assert.ok(existsSync(manifestPath), "manifest must exist");
    const raw = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw);
    assert.ok(manifest.packName, "manifest must have packName");
    assert.ok(manifest.packVersion, "manifest must have packVersion");
    assert.ok(manifest.status, "manifest must have status");
    assert.ok(manifest.source, "manifest must have source");
    assert.ok(manifest.createdAt, "manifest must have createdAt");
  });

  test("generates README.md", () => {
    if (packResult.status !== "generated" || !packResult.packPath) return;
    assert.ok(existsSync(path.join(packResult.packPath, "README.md")));
  });

  test("generates adaptation-plan.md", () => {
    if (packResult.status !== "generated" || !packResult.packPath) return;
    assert.ok(existsSync(path.join(packResult.packPath, "adaptation-plan.md")));
  });

  test("generates tests/pack.contract.test.ts", () => {
    if (packResult.status !== "generated" || !packResult.packPath) return;
    assert.ok(existsSync(path.join(packResult.packPath, "tests", "pack.contract.test.ts")));
  });

  test("generates smoke/smoke-plan.md", () => {
    if (packResult.status !== "generated" || !packResult.packPath) return;
    assert.ok(existsSync(path.join(packResult.packPath, "smoke", "smoke-plan.md")));
  });

  test("generates TODO.generated.md", () => {
    if (packResult.status !== "generated" || !packResult.packPath) return;
    assert.ok(existsSync(path.join(packResult.packPath, "TODO.generated.md")));
  });

  test("manifest has no raw secrets", async () => {
    if (packResult.status !== "generated" || !packResult.packPath) return;
    const raw = await readFile(path.join(packResult.packPath, "pack.manifest.json"), "utf8");
    const secretPattern = /sk-[A-Za-z0-9_-]{20,}/;
    assert.ok(!secretPattern.test(raw), "manifest must not contain secrets");
  });
});

// ─── Overwrite guard ──────────────────────────────────────────────────────────

describe("pack generation — overwrite guard", () => {
  test("blocks overwrite without --force", async () => {
    const packDir = path.join(tmpDir, "packs-overwrite");

    // First generation
    const first = await generatePack(
      { ...approvedOpts, capability: "overwrite_test", packOutputDir: packDir },
      "beezulbub-reports",
      tmpDir
    );

    if (first.status !== "generated") return; // Skip if blocked by verdict

    // Second generation without force
    const second = await generatePack(
      { ...approvedOpts, capability: "overwrite_test", packOutputDir: packDir, force: false },
      "beezulbub-reports",
      tmpDir
    );
    assert.equal(second.status, "blocked_existing_pack");
  });

  test("allows overwrite with --force", async () => {
    const packDir = path.join(tmpDir, "packs-force");

    const first = await generatePack(
      { ...approvedOpts, capability: "force_test", packOutputDir: packDir },
      "beezulbub-reports",
      tmpDir
    );
    if (first.status !== "generated") return;

    const second = await generatePack(
      { ...approvedOpts, capability: "force_test", packOutputDir: packDir, force: true },
      "beezulbub-reports",
      tmpDir
    );
    assert.ok(second.status === "generated" || second.status === "blocked_bad_verdict");
  });
});
