/**
 * tests/beezulbub-capability-registry.test.ts
 *
 * Tests for the capability registry (Phase 11D).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadRegistry,
  saveRegistry,
  registerPackGenerated,
  updateCapabilityStatus,
  formatCapabilityList,
  type CapabilityEntry,
} from "../src/beezulbub/capability-registry.js";
import type { PackManifest } from "../src/beezulbub/pack-types.js";

const MINIMAL_MANIFEST: PackManifest = {
  packName: "dashboard-layout",
  packVersion: "0.1.0",
  status: "skeleton",
  capabilities: ["dashboard-layout", "layout-engine"],
  source: {
    repoName: "owner/repo",
    sourceUrl: null,
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

describe("capability-registry", () => {
  let tmpDir: string;
  let registryPath: string;

  before(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "capability-registry-test-"));
    registryPath = path.join(tmpDir, "capability-registry.json");
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("loads empty registry when file does not exist", async () => {
    const registry = await loadRegistry(path.join(tmpDir, "nonexistent.json"));
    assert.deepEqual(registry.capabilities, {});
    assert.ok(typeof registry.updatedAt === "string");
  });

  it("loadRegistry never throws — returns CapabilityRegistry with updatedAt, not lastUpdated", async () => {
    // Regression: fallback must use updatedAt (not lastUpdated) to match CapabilityRegistry
    const registry = await loadRegistry(path.join(tmpDir, "also-nonexistent.json"));
    assert.ok("updatedAt" in registry, "registry must have updatedAt field");
    assert.ok(!("lastUpdated" in registry), "registry must NOT have lastUpdated (wrong field name)");
    assert.ok(!("version" in registry), "registry must NOT have version field");
  });

  it("loadRegistry returns valid CapabilityRegistry from corrupt file without throwing", async () => {
    const corruptPath = path.join(tmpDir, "corrupt.json");
    await (await import("node:fs/promises")).writeFile(corruptPath, "not valid json", "utf8");
    const registry = await loadRegistry(corruptPath); // must not throw
    assert.ok("updatedAt" in registry);
    assert.deepEqual(registry.capabilities, {});
  });

  it("registers capabilities when pack is generated", async () => {
    await registerPackGenerated(registryPath, MINIMAL_MANIFEST, path.join(tmpDir, "packs", "dashboard-layout"));
    const registry = await loadRegistry(registryPath);
    assert.ok(registry.capabilities["dashboard-layout"]);
    assert.ok(registry.capabilities["layout-engine"]);
    assert.equal(registry.capabilities["dashboard-layout"]!.status, "pack_skeleton_created");
    assert.equal(registry.capabilities["dashboard-layout"]!.capabilityId, "dashboard-layout");
  });

  it("updates capability status", async () => {
    await updateCapabilityStatus(registryPath, "dashboard-layout", "implementation_draft");
    const registry = await loadRegistry(registryPath);
    assert.equal(registry.capabilities["dashboard-layout"]!.status, "implementation_draft");
  });

  it("formatCapabilityList shows all capabilities", async () => {
    const registry = await loadRegistry(registryPath);
    const list = formatCapabilityList(registry);
    assert.ok(list.includes("dashboard-layout"));
    assert.ok(list.includes("implementation_draft"));
  });

  it("saves and reloads registry", async () => {
    const freshPath = path.join(tmpDir, "fresh-registry.json");
    const registry = await loadRegistry(freshPath);
    const entry: CapabilityEntry = {
      capabilityId: "test-cap",
      name: "Test Cap",
      status: "available",
      usedByAgents: [],
      updatedAt: new Date().toISOString(),
    };
    registry.capabilities["test-cap"] = entry;
    await saveRegistry(freshPath, registry);
    const reloaded = await loadRegistry(freshPath);
    assert.ok(reloaded.capabilities["test-cap"]);
    assert.equal(reloaded.capabilities["test-cap"]!.status, "available");
  });

  it("formatCapabilityList handles empty registry", async () => {
    const emptyRegistry = { capabilities: {}, updatedAt: "" };
    const list = formatCapabilityList(emptyRegistry);
    assert.ok(typeof list === "string");
    assert.ok(list.includes("No capabilities"));
  });
});
