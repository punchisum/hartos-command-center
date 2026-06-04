/**
 * tests/fitness-agent-adapter.test.ts — Phase 11I.
 * Fitness adapter detects a fake fixture repo/handover; missing repo degrades.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildFitnessAgentReadModel } from "../src/agents/fitness-agent-adapter.js";
import type { AgentIntegrationConfig } from "../src/agents/agent-types.js";

async function makeFakeRepo(cwd: string): Promise<void> {
  await mkdir(path.join(cwd, "fit-repo", "docs"), { recursive: true });
  await mkdir(path.join(cwd, "fit-repo", "reports"), { recursive: true });
  await writeFile(path.join(cwd, "fit-repo", "docs", "HANDOVER.md"), "# Fitness Handover\nRecovery 72%. Training load moderate.", "utf8");
  await writeFile(path.join(cwd, "fit-repo", "reports", "briefing-2026-06-03.md"), "briefing", "utf8");
}

const config: AgentIntegrationConfig = {
  id: "fitness-agent",
  name: "Fitness Agent",
  type: "fitness",
  enabled: true,
  repoPath: "fit-repo",
  reportsPath: "fit-repo/reports",
  handoverPath: "fit-repo/docs/HANDOVER.md",
  readModel: { mode: "local_files" },
};

describe("fitness agent adapter", () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "fit-adapter-")); await makeFakeRepo(dir); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("detects the fake repo, briefing, and handover", async () => {
    const rm2 = await buildFitnessAgentReadModel(config, dir);
    assert.equal(rm2.agentType, "fitness");
    assert.equal(rm2.status, "ok");
    assert.equal(rm2.cards.length, 4);
    assert.ok(rm2.cards[1]!.summary.includes("briefing-2026-06-03.md"));
    assert.ok(rm2.cards[2]!.summary.includes("Recovery 72%"));
  });

  it("never surfaces Apple Health / Google Drive mutations", async () => {
    const rm2 = await buildFitnessAgentReadModel(config, dir);
    for (const card of rm2.cards) {
      assert.ok(card.blockedActions.includes("mutate_apple_health"));
      assert.ok(card.blockedActions.includes("mutate_google_drive"));
    }
  });

  it("degrades to missing when the repo path is absent", async () => {
    const rm2 = await buildFitnessAgentReadModel({ ...config, repoPath: "nope" }, dir);
    assert.equal(rm2.status, "missing");
  });
});
