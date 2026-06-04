/**
 * tests/cockpit-orchestrator-bridge.test.ts
 *
 * Phase 11H — Orchestrator message bridge tests. Local, no network, no mutation.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  askOrchestrator,
  makeMessageInput,
  CockpitRequestError,
} from "../src/cockpit/cockpit-orchestrator-bridge.js";

async function setupAgentDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "cockpit-bridge-"));
  const caps = path.join(dir, "capabilities");
  await mkdir(caps, { recursive: true });
  await writeFile(path.join(caps, "capability-registry.json"), JSON.stringify({ capabilities: {}, updatedAt: "2026-01-01T00:00:00Z" }, null, 2), "utf8");
  await writeFile(path.join(caps, "provenance-ledger.json"), JSON.stringify({ entries: [], updatedAt: "2026-01-01T00:00:00Z" }, null, 2), "utf8");
  return dir;
}

describe("cockpit orchestrator bridge", () => {
  let dir: string;
  before(async () => { dir = await setupAgentDir(); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("returns a structured response", async () => {
    const response = await askOrchestrator(makeMessageInput("Build me a tax specialist agent"), { cwd: dir });
    assert.ok(response.requestId);
    assert.ok(response.threadId.startsWith("thread-"));
    assert.ok(response.classification.classification);
    assert.ok(typeof response.capabilityGaps === "string");
    assert.ok(typeof response.buildPlanSummary === "string");
    assert.ok(response.nextRecommendedCommand.startsWith("npm run"));
  });

  it("exposes blocked + approval-required actions but executes nothing", async () => {
    const response = await askOrchestrator(makeMessageInput("Build me a dashboard cockpit"), { cwd: dir });
    assert.ok(response.blockedActions.includes("execute_provider_mutation"));
    assert.ok(response.approvalRequiredActions.includes("promote_pack"));
  });

  it("writes local thread + message + report files", async () => {
    await askOrchestrator(makeMessageInput("Build me a receipt agent"), { cwd: dir });
    const threadsDir = path.join(dir, "cockpit-threads");
    const reportsDir = path.join(dir, "cockpit-reports");
    assert.ok(existsSync(threadsDir));
    assert.ok(existsSync(reportsDir));
    const threadFiles = await readdir(threadsDir);
    assert.ok(threadFiles.some((f) => f.startsWith("thread-") && f.endsWith(".json")));
    assert.ok(threadFiles.some((f) => f.startsWith("message-") && f.endsWith(".json")));
    const reportFiles = await readdir(reportsDir);
    assert.ok(reportFiles.some((f) => f.startsWith("cockpit-thread-") && f.endsWith(".md")));
  });

  it("appends to an existing thread when threadId is supplied", async () => {
    const first = await askOrchestrator(makeMessageInput("First request"), { cwd: dir });
    const second = await askOrchestrator(makeMessageInput("Second request", first.threadId), { cwd: dir });
    assert.equal(second.threadId, first.threadId);
  });

  it("rejects empty requests", async () => {
    await assert.rejects(() => askOrchestrator(makeMessageInput("   "), { cwd: dir }), CockpitRequestError);
  });

  it("rejects secret-looking requests", async () => {
    const secret = "my key is sk-" + "a".repeat(32);
    await assert.rejects(() => askOrchestrator(makeMessageInput(secret), { cwd: dir }), CockpitRequestError);
  });

  it("does not create capabilities/ or packs/ directories", async () => {
    const writeDir = await setupAgentDir();
    try {
      // Remove capabilities to confirm the bridge does not recreate/mutate it.
      await rm(path.join(writeDir, "capabilities"), { recursive: true, force: true });
      await askOrchestrator(makeMessageInput("Build something"), { cwd: writeDir });
      assert.ok(!existsSync(path.join(writeDir, "packs")), "must not create packs/");
      assert.ok(!existsSync(path.join(writeDir, "capabilities")), "must not create capabilities/");
    } finally {
      await rm(writeDir, { recursive: true, force: true });
    }
  });
});
