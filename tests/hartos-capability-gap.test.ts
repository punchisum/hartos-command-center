/**
 * tests/hartos-capability-gap.test.ts
 *
 * Phase 11F — capability gap detection tests.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectCapabilityGaps } from "../src/hartos/capability-gap.js";

interface CapSpec { status: string; provenance: boolean; }

async function writeFixtures(dir: string, caps: Record<string, CapSpec>): Promise<{ registryPath: string; ledgerPath: string }> {
  const capsDir = path.join(dir, "capabilities");
  await mkdir(capsDir, { recursive: true });
  const registry = { capabilities: {} as Record<string, unknown>, updatedAt: "2026-01-01T00:00:00Z" };
  const ledgerEntries: unknown[] = [];
  for (const [capId, spec] of Object.entries(caps)) {
    registry.capabilities[capId] = { capabilityId: capId, name: capId, status: spec.status, usedByAgents: [], updatedAt: "2026-01-01T00:00:00Z" };
    if (spec.provenance) {
      ledgerEntries.push({ capabilityId: capId, packName: `${capId}-pack`, sourceRepo: "owner/repo", sourceUrl: null, license: "MIT", verdict: "DEVOUR", scoreOverall: 8, absorbed: [], rejected: [], thirdPartyCodeCopied: false, createdAt: "2026-01-01T00:00:00Z" });
    }
  }
  const registryPath = path.join(capsDir, "capability-registry.json");
  const ledgerPath = path.join(capsDir, "provenance-ledger.json");
  await writeFile(registryPath, JSON.stringify(registry, null, 2), "utf8");
  await writeFile(ledgerPath, JSON.stringify({ entries: ledgerEntries, updatedAt: "2026-01-01T00:00:00Z" }, null, 2), "utf8");
  return { registryPath, ledgerPath };
}

describe("hartos capability-gap", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "hartos-gap-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("detects missing receipt OCR for a tax agent", async () => {
    const dir = await mkdtemp(path.join(tmpDir, "tax-"));
    const { registryPath, ledgerPath } = await writeFixtures(dir, {}); // empty registry
    const gap = await detectCapabilityGaps("build a tax specialist agent", { registryPath, ledgerPath, cwd: dir });
    assert.equal(gap.buildTarget, "tax_specialist");
    assert.ok(gap.requiredCapabilities.includes("receipt_ocr"));
    assert.ok(gap.missingCapabilities.includes("receipt_ocr"));
    const item = gap.items.find((i) => i.capabilityId === "receipt_ocr");
    assert.ok(item);
    assert.equal(item!.usability, "missing");
    assert.ok(item!.recommendedBeezulbubAction !== null);
  });

  it("detects dashboard_layout as usable when verified + provenance", async () => {
    const dir = await mkdtemp(path.join(tmpDir, "dash-"));
    const { registryPath, ledgerPath } = await writeFixtures(dir, {
      dashboard_layout: { status: "verified", provenance: true },
    });
    const gap = await detectCapabilityGaps("build a dashboard cockpit", { registryPath, ledgerPath, cwd: dir });
    assert.ok(gap.usableCapabilities.includes("dashboard_layout"));
    const item = gap.items.find((i) => i.capabilityId === "dashboard_layout");
    assert.equal(item!.usability, "usable");
    assert.equal(item!.recommendedBeezulbubAction, null);
  });

  it("recommends a Beezulbub action for missing capabilities", async () => {
    const dir = await mkdtemp(path.join(tmpDir, "miss-"));
    const { registryPath, ledgerPath } = await writeFixtures(dir, {});
    const gap = await detectCapabilityGaps("build a receipt OCR agent", { registryPath, ledgerPath, cwd: dir });
    const missingItems = gap.items.filter((i) => i.usability === "missing");
    assert.ok(missingItems.length > 0);
    for (const item of missingItems) {
      assert.ok(item.recommendedBeezulbubAction !== null);
    }
  });

  it("does NOT recommend a Beezulbub action when capability is already available", async () => {
    const dir = await mkdtemp(path.join(tmpDir, "avail-"));
    const { registryPath, ledgerPath } = await writeFixtures(dir, {
      receipt_ocr: { status: "available", provenance: true },
    });
    const gap = await detectCapabilityGaps("build a receipt agent", {
      registryPath, ledgerPath, cwd: dir, requiredCapabilities: ["receipt_ocr"],
    });
    const item = gap.items.find((i) => i.capabilityId === "receipt_ocr");
    assert.equal(item!.usability, "usable");
    assert.equal(item!.recommendedBeezulbubAction, null);
  });

  it("treats implementation_draft as planning_only", async () => {
    const dir = await mkdtemp(path.join(tmpDir, "draft-"));
    const { registryPath, ledgerPath } = await writeFixtures(dir, {
      receipt_ocr: { status: "implementation_draft", provenance: true },
    });
    const gap = await detectCapabilityGaps("build a receipt agent", {
      registryPath, ledgerPath, cwd: dir, requiredCapabilities: ["receipt_ocr"],
    });
    assert.ok(gap.planningOnlyCapabilities.includes("receipt_ocr"));
  });
});
