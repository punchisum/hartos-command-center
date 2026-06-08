/**
 * tests/ops-agent-adapter.test.ts — Phase 11I.
 * Ops adapter detects a fake fixture repo/handover; missing repo degrades safely.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildOpsAgentReadModel } from "../src/agents/ops-agent-adapter.js";
import type { AgentIntegrationConfig } from "../src/agents/agent-types.js";

async function makeFakeRepo(cwd: string): Promise<void> {
  await mkdir(path.join(cwd, "ops-repo", "docs"), { recursive: true });
  await mkdir(path.join(cwd, "ops-repo", "reports"), { recursive: true });
  await writeFile(path.join(cwd, "ops-repo", "docs", "HANDOVER.md"), "# Ops Handover\nClickUp import healthy. 12 active cards.", "utf8");
  await writeFile(path.join(cwd, "ops-repo", "reports", "ops-2026-06-01.md"), "report", "utf8");
}

const config: AgentIntegrationConfig = {
  id: "ops-agent-v2",
  name: "GECAN Ops AI",
  type: "ops",
  enabled: true,
  repoPath: "ops-repo",
  reportsPath: "ops-repo/reports",
  handoverPath: "ops-repo/docs/HANDOVER.md",
  readModel: { mode: "local_files" },
};

describe("ops agent adapter", () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "ops-adapter-")); await makeFakeRepo(dir); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("detects the fake repo, handover, and reports", async () => {
    const rm2 = await buildOpsAgentReadModel(config, dir);
    assert.equal(rm2.agentType, "ops");
    assert.equal(rm2.status, "ok");
    assert.equal(rm2.cards.length, 4);
    const sysCard = rm2.cards[0]!;
    assert.equal(sysCard.metrics["repoDetected"], "true");
    const handoverCard = rm2.cards[1]!;
    assert.ok(handoverCard.summary.includes("ClickUp import healthy"));
    assert.ok(handoverCard.latestReportPaths.length >= 1);
  });

  it("links evidence on the claim-bearing cards (fixes the zero-links bug)", async () => {
    const rm2 = await buildOpsAgentReadModel(config, dir);
    // Was: only card[1] carried report links → 3 of 4 cards were dead ends.
    assert.ok(rm2.cards[0]!.latestReportPaths.length >= 1, "System Status links its latest report");
    assert.ok(rm2.cards[3]!.latestReportPaths.length >= 1, "Recent Activity links the recent reports");
    const cardsWithLinks = rm2.cards.filter((c) => c.latestReportPaths.length > 0).length;
    assert.ok(cardsWithLinks >= 3, `expected ≥3 cards to carry evidence, got ${cardsWithLinks}`);
  });

  it("never surfaces executable/mutation actions", async () => {
    const rm2 = await buildOpsAgentReadModel(config, dir);
    for (const card of rm2.cards) {
      assert.ok(card.blockedActions.includes("mutate_clickup"));
      assert.ok(card.blockedActions.includes("mutate_supabase"));
    }
  });

  it("degrades to missing when the repo path is absent", async () => {
    const rm2 = await buildOpsAgentReadModel({ ...config, repoPath: "does-not-exist" }, dir);
    assert.equal(rm2.status, "missing");
    assert.ok(rm2.cards[0]!.missingSources.includes("does-not-exist"));
  });

  it("renders unconfigured when disabled", async () => {
    const rm2 = await buildOpsAgentReadModel({ ...config, enabled: false }, dir);
    assert.equal(rm2.status, "unconfigured");
  });
});
