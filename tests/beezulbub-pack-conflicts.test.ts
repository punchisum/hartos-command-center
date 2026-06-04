/**
 * tests/beezulbub-pack-conflicts.test.ts
 *
 * Tests for pack conflict detection (Phase 11D).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectConflicts, formatConflictReport } from "../src/beezulbub/pack-conflicts.js";

async function writePack(
  dir: string,
  name: string,
  caps: string[],
  contracts: Record<string, string[]> = {}
): Promise<string> {
  const packDir = path.join(dir, name);
  await mkdir(packDir, { recursive: true });
  const manifest = {
    packName: name,
    status: "skeleton",
    capabilities: caps,
    source: { repo: "owner/repo", verdict: "DEVOUR" },
    contracts,
    generatedAt: "2026-01-01T00:00:00Z",
  };
  await writeFile(path.join(packDir, "pack.manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return packDir;
}

describe("pack-conflicts", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pack-conflicts-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("no conflicts with single pack", async () => {
    const packA = await writePack(tmpDir, "solo-pack", ["solo-cap"]);
    const report = await detectConflicts([packA]);
    assert.equal(report.status, "clean");
    assert.equal(report.conflicts.length, 0);
  });

  it("detects duplicate capability IDs", async () => {
    const dir = await mkdtemp(path.join(tmpDir, "dup-cap-"));
    const packA = await writePack(dir, "pack-a", ["shared-cap"]);
    const packB = await writePack(dir, "pack-b", ["shared-cap"]);
    const report = await detectConflicts([packA, packB]);
    assert.equal(report.status, "conflicts_found");
    const conflict = report.conflicts.find((c) => c.type === "duplicate_capability_id");
    assert.ok(conflict, "should have duplicate_capability_id conflict");
  });

  it("detects duplicate commands", async () => {
    const dir = await mkdtemp(path.join(tmpDir, "dup-cmd-"));
    const packA = await writePack(dir, "pack-x", ["cap-x"], { commands: ["cmd:foo"] });
    const packB = await writePack(dir, "pack-y", ["cap-y"], { commands: ["cmd:foo"] });
    const report = await detectConflicts([packA, packB]);
    assert.equal(report.status, "conflicts_found");
    const conflict = report.conflicts.find((c) => c.type === "duplicate_command");
    assert.ok(conflict, "should have duplicate_command conflict");
  });

  it("no conflict with different packs and capabilities", async () => {
    const dir = await mkdtemp(path.join(tmpDir, "clean-"));
    const packA = await writePack(dir, "pack-clean-a", ["cap-a"], { commands: ["cmd:a"] });
    const packB = await writePack(dir, "pack-clean-b", ["cap-b"], { commands: ["cmd:b"] });
    const report = await detectConflicts([packA, packB]);
    assert.equal(report.status, "clean");
  });

  it("skips missing manifests gracefully", async () => {
    const dir = await mkdtemp(path.join(tmpDir, "missing-"));
    const fakePath = path.join(dir, "ghost-pack");
    await mkdir(fakePath, { recursive: true });
    const report = await detectConflicts([fakePath]);
    assert.equal(report.status, "clean");
  });

  it("formatConflictReport shows conflict details", async () => {
    const dir = await mkdtemp(path.join(tmpDir, "fmt-"));
    const packA = await writePack(dir, "pack-fmt-a", ["dup-cap"]);
    const packB = await writePack(dir, "pack-fmt-b", ["dup-cap"]);
    const report = await detectConflicts([packA, packB]);
    const formatted = formatConflictReport(report);
    assert.ok(formatted.includes("dup-cap"));
  });

  it("formatConflictReport reports clean state", async () => {
    const dir = await mkdtemp(path.join(tmpDir, "fmt-clean-"));
    const packA = await writePack(dir, "pack-alone", ["unique-cap"]);
    const report = await detectConflicts([packA]);
    const formatted = formatConflictReport(report);
    assert.ok(typeof formatted === "string");
    assert.ok(formatted.includes("No conflicts"));
  });
});
