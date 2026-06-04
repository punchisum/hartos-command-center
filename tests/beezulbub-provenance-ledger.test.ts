/**
 * tests/beezulbub-provenance-ledger.test.ts
 *
 * Tests for the provenance ledger (Phase 11D).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadLedger,
  saveLedger,
  recordProvenance,
  hasProvenance,
  getProvenance,
} from "../src/beezulbub/provenance-ledger.js";
import type { PackManifest } from "../src/beezulbub/pack-types.js";

function makeManifest(overrides: Partial<Pick<PackManifest, "packName" | "capabilities">> = {}): PackManifest {
  return {
    packName: overrides.packName ?? "test-pack",
    packVersion: "0.1.0",
    status: "skeleton",
    capabilities: overrides.capabilities ?? ["test-cap"],
    source: {
      repoName: "owner/repo",
      sourceUrl: "https://github.com/owner/repo",
      verdict: "DEVOUR",
      scoreOverall: 8,
      license: "MIT",
    },
    hartosCompatibility: {
      requiresSupabase: false,
      requiresTrigger: false,
      requiresCloudflare: false,
      requiresTelegram: false,
      requiresApprovalGate: false,
    },
    absorb: [],
    reject: [],
    requiredTests: [],
    createdAt: "2026-01-01T00:00:00Z",
  };
}

describe("provenance-ledger", () => {
  let tmpDir: string;
  let ledgerPath: string;

  before(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "provenance-ledger-test-"));
    ledgerPath = path.join(tmpDir, "provenance-ledger.json");
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("loads empty ledger when file does not exist", async () => {
    const ledger = await loadLedger(path.join(tmpDir, "nonexistent.json"));
    assert.deepEqual(ledger.entries, []);
    assert.ok(typeof ledger.updatedAt === "string");
  });

  it("records provenance from manifest", async () => {
    const manifest = makeManifest({ packName: "dash-pack", capabilities: ["dashboard-layout"] });
    await recordProvenance(ledgerPath, manifest);
    const ledger = await loadLedger(ledgerPath);
    assert.ok(hasProvenance(ledger, "dashboard-layout"));
    const prov = getProvenance(ledger, "dashboard-layout");
    assert.ok(prov);
    assert.equal(prov!.packName, "dash-pack");
  });

  it("thirdPartyCodeCopied is always false", async () => {
    const manifest = makeManifest({ packName: "nocopy-pack", capabilities: ["nocopy-cap"] });
    await recordProvenance(ledgerPath, manifest);
    const ledger = await loadLedger(ledgerPath);
    const prov = getProvenance(ledger, "nocopy-cap");
    assert.ok(prov);
    assert.equal(prov!.thirdPartyCodeCopied, false);
  });

  it("hasProvenance returns false for unknown capability", async () => {
    const ledger = await loadLedger(ledgerPath);
    assert.equal(hasProvenance(ledger, "nonexistent-cap"), false);
  });

  it("hasProvenance returns true for known capability", async () => {
    const ledger = await loadLedger(ledgerPath);
    assert.equal(hasProvenance(ledger, "dashboard-layout"), true);
  });

  it("saves and reloads ledger", async () => {
    const freshPath = path.join(tmpDir, "fresh-ledger.json");
    const manifest = makeManifest({ packName: "fresh-pack", capabilities: ["fresh-cap"] });
    await recordProvenance(freshPath, manifest);
    const reloaded = await loadLedger(freshPath);
    assert.ok(hasProvenance(reloaded, "fresh-cap"));
  });

  it("updates existing entry rather than duplicating", async () => {
    const dupPath = path.join(tmpDir, "dup-ledger.json");
    const manifest = makeManifest({ packName: "dup-pack", capabilities: ["dup-cap"] });
    await recordProvenance(dupPath, manifest);
    await recordProvenance(dupPath, manifest); // Record twice
    const ledger = await loadLedger(dupPath);
    const entries = ledger.entries.filter((e) => e.capabilityId === "dup-cap");
    assert.equal(entries.length, 1, "Should not duplicate entries");
  });
});
