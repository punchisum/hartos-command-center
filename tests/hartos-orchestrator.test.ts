/**
 * tests/hartos-orchestrator.test.ts
 *
 * Phase 11F — full orchestrator flow tests.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runOrchestrator } from "../src/hartos/orchestrator.js";

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
];

async function setupAgentDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "hartos-orch-test-"));
  const capsDir = path.join(dir, "capabilities");
  await mkdir(capsDir, { recursive: true });
  await writeFile(
    path.join(capsDir, "capability-registry.json"),
    JSON.stringify({ capabilities: {}, updatedAt: "2026-01-01T00:00:00Z" }, null, 2),
    "utf8"
  );
  await writeFile(
    path.join(capsDir, "provenance-ledger.json"),
    JSON.stringify({ entries: [], updatedAt: "2026-01-01T00:00:00Z" }, null, 2),
    "utf8"
  );
  return dir;
}

describe("hartos orchestrator", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "hartos-orch-root-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("full flow creates a report", async () => {
    const dir = await setupAgentDir();
    const reportsDir = path.join(dir, "hartos-reports");
    const result = await runOrchestrator("I want to build a tax specialist agent", { cwd: dir, reportsDir });
    assert.ok(result.reportPath, "reportPath should be set");
    const files = await readdir(reportsDir);
    assert.ok(files.some((f) => f.startsWith("orchestrator-") && f.endsWith(".md")));
    assert.ok(files.some((f) => f.startsWith("orchestrator-") && f.endsWith(".json")));
  });

  it("full flow does not mutate capability/pack files", async () => {
    const dir = await setupAgentDir();
    const registryPath = path.join(dir, "capabilities", "capability-registry.json");
    const ledgerPath = path.join(dir, "capabilities", "provenance-ledger.json");
    const registryBefore = await readFile(registryPath, "utf8");
    const ledgerBefore = await readFile(ledgerPath, "utf8");

    await runOrchestrator("build a receipt OCR agent", { cwd: dir, reportsDir: path.join(dir, "hartos-reports") });

    assert.equal(await readFile(registryPath, "utf8"), registryBefore, "registry must be unchanged");
    assert.equal(await readFile(ledgerPath, "utf8"), ledgerBefore, "ledger must be unchanged");
  });

  it("full flow writes a secret-safe report", async () => {
    const dir = await setupAgentDir();
    const reportsDir = path.join(dir, "hartos-reports");
    await runOrchestrator("build a dashboard cockpit with approval queue", { cwd: dir, reportsDir });
    const files = (await readdir(reportsDir)).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const content = await readFile(path.join(reportsDir, f), "utf8");
      for (const pattern of SECRET_PATTERNS) {
        assert.ok(!pattern.test(content), `report ${f} contains secret-like value`);
      }
    }
  });

  it("recommends CTO only when relevant (build request → CTO present)", async () => {
    const dir = await setupAgentDir();
    const result = await runOrchestrator("build a receipt OCR agent", {
      cwd: dir, reportsDir: path.join(dir, "hartos-reports"),
    });
    assert.ok(result.cto !== null, "CTO review should run for a build request");
  });

  it("does NOT run CTO for a non-engineering request (fitness)", async () => {
    const dir = await setupAgentDir();
    const result = await runOrchestrator("track my gym workout training", {
      cwd: dir, reportsDir: path.join(dir, "hartos-reports"),
    });
    assert.equal(result.cto, null, "CTO review should NOT run for a fitness request");
  });

  it("writeReport:false performs no file writes", async () => {
    const dir = await setupAgentDir();
    const reportsDir = path.join(dir, "hartos-reports");
    const result = await runOrchestrator("build a tax specialist agent", { cwd: dir, reportsDir, writeReport: false });
    assert.equal(result.reportPath, undefined);
    // hartos-reports should not exist
    let existed = true;
    try { await readdir(reportsDir); } catch { existed = false; }
    assert.equal(existed, false, "no reports dir should be created when writeReport is false");
  });

  it("produces a build plan and strategy for build requests", async () => {
    const dir = await setupAgentDir();
    const result = await runOrchestrator("build a tax specialist agent", {
      cwd: dir, reportsDir: path.join(dir, "hartos-reports"),
    });
    assert.ok(result.buildPlan !== null);
    assert.ok(result.strategy !== null);
    assert.ok(result.gap !== null);
  });
});
