/**
 * tests/hartos-cto-review.test.ts
 *
 * Phase 11F — CTO technical review tests.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { reviewCto } from "../src/hartos/cto-review.js";

interface CapSpec { status: string; provenance: boolean; }

async function writeFixtures(dir: string, caps: Record<string, CapSpec>): Promise<{ registryPath: string; ledgerPath: string }> {
  const capsDir = path.join(dir, "capabilities");
  await mkdir(capsDir, { recursive: true });

  const registry = {
    capabilities: {} as Record<string, unknown>,
    updatedAt: "2026-01-01T00:00:00Z",
  };
  const ledgerEntries: unknown[] = [];

  for (const [capId, spec] of Object.entries(caps)) {
    registry.capabilities[capId] = {
      capabilityId: capId,
      name: capId,
      status: spec.status,
      usedByAgents: [],
      updatedAt: "2026-01-01T00:00:00Z",
    };
    if (spec.provenance) {
      ledgerEntries.push({
        capabilityId: capId,
        packName: `${capId}-pack`,
        sourceRepo: "owner/repo",
        sourceUrl: null,
        license: "MIT",
        verdict: "DEVOUR",
        scoreOverall: 8,
        absorbed: [],
        rejected: [],
        thirdPartyCodeCopied: false,
        createdAt: "2026-01-01T00:00:00Z",
      });
    }
  }

  const registryPath = path.join(capsDir, "capability-registry.json");
  const ledgerPath = path.join(capsDir, "provenance-ledger.json");
  await writeFile(registryPath, JSON.stringify(registry, null, 2), "utf8");
  await writeFile(ledgerPath, JSON.stringify({ entries: ledgerEntries, updatedAt: "2026-01-01T00:00:00Z" }, null, 2), "utf8");
  return { registryPath, ledgerPath };
}

describe("hartos cto-review", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "hartos-cto-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads capability registry and reports verified+provenance as usable", async () => {
    const dir = await mkdtemp(path.join(tmpDir, "usable-"));
    const { registryPath, ledgerPath } = await writeFixtures(dir, {
      dashboard_layout: { status: "verified", provenance: true },
    });
    const r = await reviewCto("build a dashboard cockpit", {
      registryPath, ledgerPath, cwd: dir,
      requiredCapabilities: ["dashboard_layout"],
    });
    assert.ok(r.existingCapabilities.includes("dashboard_layout"));
    assert.equal(r.missingCapabilities.length, 0);
    assert.equal(r.technicalVerdict, "build_with_existing_capabilities");
  });

  it("treats available+provenance as usable", async () => {
    const dir = await mkdtemp(path.join(tmpDir, "available-"));
    const { registryPath, ledgerPath } = await writeFixtures(dir, {
      receipt_ocr: { status: "available", provenance: true },
    });
    const r = await reviewCto("build a receipt agent", {
      registryPath, ledgerPath, cwd: dir,
      requiredCapabilities: ["receipt_ocr"],
    });
    assert.ok(r.existingCapabilities.includes("receipt_ocr"));
  });

  it("treats skeleton packs as NOT usable", async () => {
    const dir = await mkdtemp(path.join(tmpDir, "skeleton-"));
    const { registryPath, ledgerPath } = await writeFixtures(dir, {
      receipt_ocr: { status: "pack_skeleton_created", provenance: true },
    });
    const r = await reviewCto("build a receipt agent", {
      registryPath, ledgerPath, cwd: dir,
      requiredCapabilities: ["receipt_ocr"],
    });
    assert.ok(!r.existingCapabilities.includes("receipt_ocr"));
    assert.ok(r.missingCapabilities.includes("receipt_ocr"));
  });

  it("treats implementation_draft as planning-only (not usable for production)", async () => {
    const dir = await mkdtemp(path.join(tmpDir, "draft-"));
    const { registryPath, ledgerPath } = await writeFixtures(dir, {
      receipt_ocr: { status: "implementation_draft", provenance: true },
    });
    const r = await reviewCto("build a receipt agent", {
      registryPath, ledgerPath, cwd: dir,
      requiredCapabilities: ["receipt_ocr"],
    });
    assert.ok(r.planningOnlyCapabilities.includes("receipt_ocr"));
    assert.ok(!r.existingCapabilities.includes("receipt_ocr"));
  });

  it("requires provenance before recommending a capability as usable", async () => {
    const dir = await mkdtemp(path.join(tmpDir, "noprov-"));
    const { registryPath, ledgerPath } = await writeFixtures(dir, {
      dashboard_layout: { status: "verified", provenance: false },
    });
    const r = await reviewCto("build a dashboard cockpit", {
      registryPath, ledgerPath, cwd: dir,
      requiredCapabilities: ["dashboard_layout"],
    });
    assert.ok(!r.existingCapabilities.includes("dashboard_layout"), "verified without provenance must NOT be usable");
  });

  it("recommends beezulbub acquisition for fully missing capabilities", async () => {
    const dir = await mkdtemp(path.join(tmpDir, "missing-"));
    const { registryPath, ledgerPath } = await writeFixtures(dir, {});
    const r = await reviewCto("build a receipt OCR agent", {
      registryPath, ledgerPath, cwd: dir,
      requiredCapabilities: ["receipt_ocr"],
    });
    assert.ok(r.missingCapabilities.includes("receipt_ocr"));
    assert.equal(r.technicalVerdict, "needs_beezulbub_acquisition");
    assert.ok(r.recommendedBeezulbubActions.some((a) => a.includes("receipt_ocr")));
  });
});
