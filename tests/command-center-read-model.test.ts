/**
 * tests/command-center-read-model.test.ts
 *
 * Phase 11G — read model tests. Reads LOCAL files only and degrades safely.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildReadModel,
  assessPacks,
  classifyPackUsability,
  collectMissingSources,
} from "../src/command-center/read-model.js";

async function makeTmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "cc-read-model-"));
}

async function scaffoldPack(root: string, name: string, status: string): Promise<void> {
  const dir = path.join(root, "packs", name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "pack.manifest.json"),
    JSON.stringify({ packName: name, packVersion: "0.1.0", status }, null, 2),
    "utf8"
  );
}

describe("command center read model — empty workspace", () => {
  let dir: string;
  before(async () => { dir = await makeTmp(); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("degrades safely when no reports/dirs exist", async () => {
    const models = await buildReadModel({ cwd: dir });
    assert.ok(models.length > 0);
    for (const m of models) {
      // Nothing present, so file/dir cards must be missing with a safe recommendation.
      if (m.status === "missing") {
        assert.equal(m.confidence, "low");
        assert.ok(m.safeRecommendation.length > 0);
        assert.ok(!m.safeRecommendation.includes("provider"), "recommendation must not be a mutation");
      }
    }
  });

  it("does not throw and reports missing sources", async () => {
    const models = await buildReadModel({ cwd: dir });
    const missing = collectMissingSources(models);
    assert.ok(Array.isArray(missing));
  });
});

describe("command center read model — with local data", () => {
  let dir: string;
  before(async () => {
    dir = await makeTmp();
    await mkdir(path.join(dir, "hartos-reports"), { recursive: true });
    await writeFile(path.join(dir, "hartos-reports", "orchestrator-2026.md"), "# report\n", "utf8");
    await mkdir(path.join(dir, "capabilities"), { recursive: true });
    await writeFile(
      path.join(dir, "capabilities", "capability-registry.json"),
      JSON.stringify({ capabilities: {}, updatedAt: "2026-01-01T00:00:00Z" }, null, 2),
      "utf8"
    );
  });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("marks present sources as ok", async () => {
    const models = await buildReadModel({ cwd: dir });
    const orch = models.find((m) => m.cardId === "orchestrator_latest_request");
    assert.ok(orch);
    assert.equal(orch!.status, "ok");
    const reg = models.find((m) => m.cardId === "beezulbub_capability_registry");
    assert.equal(reg!.status, "ok");
  });
});

describe("command center read model — pack usability (11D/11E governance)", () => {
  it("never treats skeleton or implementation_draft packs as usable", () => {
    assert.equal(classifyPackUsability("skeleton", true).usability, "not_usable");
    assert.equal(classifyPackUsability("skeleton", false).usability, "not_usable");
    assert.equal(classifyPackUsability("implementation_draft", true).usability, "planning_only");
    assert.notEqual(classifyPackUsability("implementation_draft", true).usability, "usable");
  });

  it("requires provenance even for verified/available packs", () => {
    assert.equal(classifyPackUsability("verified", false).usability, "not_usable");
    assert.equal(classifyPackUsability("verified", true).usability, "usable");
    assert.equal(classifyPackUsability("available", false).usability, "not_usable");
  });

  it("assesses packs from local manifests", async () => {
    const dir = await makeTmp();
    try {
      await scaffoldPack(dir, "draft-pack", "implementation_draft");
      await scaffoldPack(dir, "skeleton-pack", "skeleton");
      const packs = await assessPacks({ cwd: dir });
      const draft = packs.find((p) => p.name === "draft-pack");
      const skeleton = packs.find((p) => p.name === "skeleton-pack");
      assert.equal(draft!.usability, "planning_only");
      assert.equal(skeleton!.usability, "not_usable");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns empty when packs/ is absent", async () => {
    const dir = await makeTmp();
    try {
      assert.deepEqual(await assessPacks({ cwd: dir }), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
