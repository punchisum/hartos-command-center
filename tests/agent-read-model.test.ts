/**
 * tests/agent-read-model.test.ts — Phase 11I.
 * Whole-registry summary degrades safely with no config and aggregates adapters.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildAgentIntegrationSummary } from "../src/agents/agent-read-model.js";
import { LOCAL_CONFIG_FILE } from "../src/agents/agent-registry.js";

describe("agent read model", () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "agent-readmodel-")); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("returns an unconfigured summary with no config", async () => {
    const summary = await buildAgentIntegrationSummary({ cwd: dir });
    assert.equal(summary.configPresent, false);
    assert.equal(summary.configuredAgents, 0);
    assert.ok(summary.nextRecommendedCommand.includes("agent-integrations.local.json"));
  });

  it("aggregates ops + fitness adapters when configured", async () => {
    await mkdir(path.join(dir, "ops-repo"), { recursive: true });
    await mkdir(path.join(dir, "fit-repo"), { recursive: true });
    await writeFile(
      path.join(dir, LOCAL_CONFIG_FILE),
      JSON.stringify({
        agents: [
          { id: "ops-agent-v2", name: "Ops", type: "ops", enabled: true, repoPath: "ops-repo" },
          { id: "fitness-agent", name: "Fitness", type: "fitness", enabled: true, repoPath: "fit-repo" },
        ],
      }),
      "utf8"
    );
    const summary = await buildAgentIntegrationSummary({ cwd: dir });
    assert.equal(summary.configPresent, true);
    assert.equal(summary.configuredAgents, 2);
    assert.equal(summary.detectedAgents, 2);
    assert.equal(summary.agents.map((a) => a.agentType).sort().join(","), "fitness,ops");
  });
});
