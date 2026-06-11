/**
 * tests/beezulbub-pack-registry.test.ts
 *
 * Tests for the pack registry (list packs).
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { listPacks, formatPackList } from "../src/beezulbub/pack-registry.js";
import type { PackManifest } from "../src/beezulbub/pack-types.js";

let tmpDir: string;
let packsDir: string;

function makeManifest(packName: string, verdict = "DEVOUR", score = 7.5): PackManifest {
  return {
    packName,
    packVersion: "0.1.0",
    status: "skeleton",
    source: {
      repoName: `${packName}-source`,
      sourceUrl: null,
      verdict,
      scoreOverall: score,
      license: "MIT",
    },
    capabilities: [packName],
    hartosCompatibility: {
      requiresSupabase: false,
      requiresTrigger: false,
      requiresCloudflare: false,
      requiresTelegram: false,
      requiresApprovalGate: true,
    },
    absorb: ["layout pattern"],
    reject: ["auth model"],
    requiredTests: ["contract test"],
    createdAt: new Date().toISOString(),
  };
}

before(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "hartos-pack-registry-test-"));
  packsDir = path.join(tmpDir, "packs");
  await mkdir(packsDir, { recursive: true });

  // Write two packs
  for (const pack of ["dashboard_layout", "receipt_ocr"]) {
    await mkdir(path.join(packsDir, pack), { recursive: true });
    await writeFile(
      path.join(packsDir, pack, "pack.manifest.json"),
      JSON.stringify(makeManifest(pack, "DEVOUR", pack === "dashboard_layout" ? 7.9 : 6.5)),
      "utf8"
    );
  }
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("listPacks", () => {
  test("lists all packs", async () => {
    const packs = await listPacks(packsDir);
    assert.ok(packs.length >= 2, "Should list at least 2 packs");
  });

  test("packs are sorted by score descending", async () => {
    const packs = await listPacks(packsDir);
    const scores = packs.map((p) => p.score);
    for (let i = 0; i < scores.length - 1; i++) {
      assert.ok(scores[i]! >= scores[i + 1]!, "Packs must be sorted by score desc");
    }
  });

  test("each entry has required fields", async () => {
    const packs = await listPacks(packsDir);
    for (const pack of packs) {
      assert.ok(pack.packName, "Must have packName");
      assert.ok(pack.version, "Must have version");
      assert.ok(pack.status, "Must have status");
      assert.ok(Array.isArray(pack.capabilities), "Must have capabilities");
    }
  });

  test("returns empty array when no packs directory", async () => {
    const packs = await listPacks("/nonexistent/packs/dir");
    assert.deepEqual(packs, []);
  });

  test("skips directories without manifest", async () => {
    // Create a dir without manifest
    await mkdir(path.join(packsDir, "no-manifest"), { recursive: true });
    const packs = await listPacks(packsDir);
    const names = packs.map((p) => p.packName);
    assert.ok(!names.includes("no-manifest"), "Should skip dirs without manifest");
  });
});

describe("formatPackList", () => {
  test("shows empty state for no packs", () => {
    const formatted = formatPackList([]);
    assert.ok(formatted.includes("No packs") || formatted.includes("pack-generate"));
  });

  test("includes pack names when packs exist", async () => {
    const packs = await listPacks(packsDir);
    const formatted = formatPackList(packs);
    assert.ok(formatted.includes("dashboard_layout") || formatted.includes("receipt_ocr"));
  });

  test("does not contain secrets", async () => {
    const packs = await listPacks(packsDir);
    const formatted = formatPackList(packs);
    const secretPattern = /[A-Za-z0-9+=_-]{40,}/;
    assert.ok(!secretPattern.test(formatted), "List must not contain secrets");
  });
});
