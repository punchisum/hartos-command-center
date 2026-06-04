/**
 * tests/hartos-handover.test.ts
 *
 * Phase 11F — handover tests.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runOrchestrator } from "../src/hartos/orchestrator.js";
import { generateHandover } from "../src/hartos/handover.js";

async function setupAgentDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "hartos-handover-test-"));
  const capsDir = path.join(dir, "capabilities");
  await mkdir(capsDir, { recursive: true });
  await writeFile(path.join(capsDir, "capability-registry.json"), JSON.stringify({ capabilities: {}, updatedAt: "2026-01-01T00:00:00Z" }, null, 2), "utf8");
  await writeFile(path.join(capsDir, "provenance-ledger.json"), JSON.stringify({ entries: [], updatedAt: "2026-01-01T00:00:00Z" }, null, 2), "utf8");
  return dir;
}

describe("hartos handover", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "hartos-handover-root-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads the latest orchestrator report", async () => {
    const dir = await setupAgentDir();
    const reportsDir = path.join(dir, "hartos-reports");
    await runOrchestrator("build a tax specialist agent", { cwd: dir, reportsDir });

    const handover = await generateHandover({ cwd: dir, reportsDir });
    assert.equal(handover.request, "build a tax specialist agent");
    assert.ok(handover.sourceReport !== null);
  });

  it("includes current request, verdicts, next action, and risks", async () => {
    const dir = await setupAgentDir();
    const reportsDir = path.join(dir, "hartos-reports");
    await runOrchestrator("build a tax specialist agent", { cwd: dir, reportsDir });

    const handover = await generateHandover({ cwd: dir, reportsDir });
    assert.ok(handover.classification);
    assert.ok(handover.strategyVerdict);
    assert.ok(handover.recommendedNextAction.length > 0);
    assert.ok(Array.isArray(handover.risks));
    assert.ok(Array.isArray(handover.commandsToRunNext));
    assert.ok(handover.commandsToRunNext.length > 0);
  });

  it("degrades safely when no reports exist", async () => {
    const dir = await mkdtemp(path.join(tmpDir, "empty-"));
    const handover = await generateHandover({ cwd: dir, reportsDir: path.join(dir, "hartos-reports") });
    assert.equal(handover.request, null);
    assert.equal(handover.sourceReport, null);
    assert.ok(handover.recommendedNextAction.includes("hartos:orchestrate"));
    assert.ok(handover.commandsToRunNext.length > 0);
  });

  it("reads the most recent report when multiple exist", async () => {
    const dir = await setupAgentDir();
    const reportsDir = path.join(dir, "hartos-reports");
    await runOrchestrator("build a receipt OCR agent", { cwd: dir, reportsDir });
    // Ensure a distinct, later timestamp for the second report.
    await new Promise((r) => setTimeout(r, 10));
    await runOrchestrator("build a dashboard cockpit", { cwd: dir, reportsDir });

    const handover = await generateHandover({ cwd: dir, reportsDir });
    assert.equal(handover.request, "build a dashboard cockpit");
  });
});
