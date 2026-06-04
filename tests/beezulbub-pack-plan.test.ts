/**
 * tests/beezulbub-pack-plan.test.ts
 *
 * Tests for Beezulbub pack plan generation.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildPackPlan, formatPackPlan } from "../src/beezulbub/pack-plan.js";

let tmpDir: string;
let reportsDir: string;

before(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "hartos-pack-plan-test-"));
  reportsDir = path.join(tmpDir, "beezulbub-reports");
  await mkdir(reportsDir, { recursive: true });
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeScoreFile(name: string, data: object): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(reportsDir, `score-${ts}-${name}.json`);
  await writeFile(filePath, JSON.stringify(data), "utf8");
  return filePath;
}

async function writeBatchFile(data: object): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(reportsDir, `batch-digest-${ts}.json`);
  await writeFile(filePath, JSON.stringify(data), "utf8");
  return filePath;
}

describe("buildPackPlan — clean digest", () => {
  test("returns a plan from a clean score file", async () => {
    await writeScoreFile("clean", {
      repoName: "clean-dashboard",
      verdict: "DEVOUR",
      score: { overall: 7.9, licenseSafety: 9 },
      capabilities: ["dashboard_layout"],
      targetPack: "dashboard-pack",
      license: "MIT",
    });
    const plan = await buildPackPlan(reportsDir);
    assert.ok(plan !== null, "Plan must be returned for a valid score");
    assert.ok(plan.sourceRepo === "clean-dashboard");
    assert.ok(plan.verdict === "DEVOUR");
  });

  test("plan includes absorb and reject lists", async () => {
    const plan = await buildPackPlan(reportsDir);
    assert.ok(plan !== null);
    assert.ok(Array.isArray(plan!.absorb));
    assert.ok(Array.isArray(plan!.reject));
    assert.ok(plan!.absorb.length > 0);
    assert.ok(plan!.reject.length > 0);
  });

  test("plan includes pack structure preview", async () => {
    const plan = await buildPackPlan(reportsDir);
    assert.ok(plan !== null);
    assert.ok(Array.isArray(plan!.structurePreview));
    assert.ok(plan!.structurePreview.some((l) => l.includes("manifest")));
  });

  test("plan includes next command for DEVOUR", async () => {
    const plan = await buildPackPlan(reportsDir);
    assert.ok(plan !== null);
    assert.ok(plan!.nextCommand.includes("pack-generate") || plan!.nextCommand.includes("approve-devour"));
  });

  test("plan includes risks", async () => {
    const plan = await buildPackPlan(reportsDir);
    assert.ok(plan !== null);
    assert.ok(Array.isArray(plan!.risks));
  });
});

describe("buildPackPlan — batch report", () => {
  test("batch plan chooses highest-scoring candidate", async () => {
    await writeBatchFile({
      target: "dashboard_layout",
      status: "completed",
      ranking: [
        { name: "clean-dashboard", verdict: "DEVOUR", overall: 7.9 },
        { name: "risky-repo", verdict: "REJECT_LICENSE", overall: 1.3 },
      ],
      topCandidate: "clean-dashboard",
      recommendation: "Best: clean-dashboard",
    });
    const plan = await buildPackPlan(reportsDir);
    assert.ok(plan !== null);
    assert.ok(
      plan!.sourceRepo === "clean-dashboard" || plan!.verdict === "DEVOUR",
      "Should prefer clean-dashboard from batch"
    );
  });
});

describe("buildPackPlan — no reports", () => {
  test("returns null when no reports exist", async () => {
    const emptyDir = await mkdtemp(path.join(tmpdir(), "hartos-empty-reports-"));
    try {
      const plan = await buildPackPlan(emptyDir);
      assert.equal(plan, null);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  test("does not create packs/ directory during planning", async () => {
    await buildPackPlan(reportsDir);
    const packsDir = path.join(tmpDir, "packs");
    assert.ok(!existsSync(packsDir), "packs/ must not be created during planning");
  });
});

describe("formatPackPlan", () => {
  test("includes pack name and source", async () => {
    const plan = await buildPackPlan(reportsDir);
    if (!plan) return;
    const formatted = formatPackPlan(plan);
    assert.ok(formatted.includes("Pack Plan"));
    assert.ok(formatted.includes(plan.sourceRepo) || formatted.includes(plan.packName));
  });

  test("does not contain secret-like values", async () => {
    const plan = await buildPackPlan(reportsDir);
    if (!plan) return;
    const formatted = formatPackPlan(plan);
    const secretPattern = /[A-Za-z0-9+/=_-]{40,}/;
    assert.ok(!secretPattern.test(formatted), "Plan must not contain secrets");
  });
});
