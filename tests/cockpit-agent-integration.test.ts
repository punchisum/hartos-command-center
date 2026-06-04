/**
 * tests/cockpit-agent-integration.test.ts — Phase 11I.
 * Cockpit state includes agent + read-model summaries; renderer surfaces them;
 * Ask HartOS attaches LLM context; no action buttons become executable.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCockpitState } from "../src/cockpit/cockpit-read-model.js";
import { renderCockpitHtml } from "../src/cockpit/cockpit-renderer.js";
import { askOrchestrator, makeMessageInput } from "../src/cockpit/cockpit-orchestrator-bridge.js";

describe("cockpit agent + data integration", () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "cockpit-agent-int-")); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("state includes agent integration + read-model summaries (unconfigured by default)", async () => {
    const state = await buildCockpitState({ cwd: dir });
    assert.ok(state.agentIntegration);
    assert.equal(state.agentIntegration!.configPresent, false);
    assert.ok(state.readModels);
    assert.equal(state.readModels!.configPresent, false);
  });

  it("renderer shows Real Agents + Real Data sections", async () => {
    const state = await buildCockpitState({ cwd: dir });
    const html = renderCockpitHtml(state, { serverMode: true });
    assert.ok(html.includes('id="real-agents"'));
    assert.ok(html.includes('id="real-data"'));
    assert.ok(html.includes("Real Agents"));
    assert.ok(html.includes("Real Data"));
  });

  it("surfaces configured agents as read-only cards", async () => {
    await mkdir(path.join(dir, "ops-repo"), { recursive: true });
    await writeFile(
      path.join(dir, "agent-integrations.local.json"),
      JSON.stringify({ agents: [{ id: "ops-agent-v2", name: "Ops", type: "ops", enabled: true, repoPath: "ops-repo" }] }),
      "utf8"
    );
    const state = await buildCockpitState({ cwd: dir });
    assert.equal(state.agentIntegration!.configuredAgents, 1);
    const html = renderCockpitHtml(state, { serverMode: true });
    assert.ok(html.includes("Ops"));
  });

  it("Ask HartOS attaches LLM context (deterministic fallback by default)", async () => {
    const response = await askOrchestrator(makeMessageInput("What is the status of my Ops Agent and Fitness Agent?"), {
      cwd: dir,
      write: false,
    });
    assert.ok(response.llmSummary, "expected an LLM summary");
    assert.equal(response.llmProvider, "deterministic");
    assert.ok(response.llmMode === "deterministic" || response.llmMode === "fallback");
  });

  it("no action becomes executable (read-only cockpit)", async () => {
    const state = await buildCockpitState({ cwd: dir });
    for (const card of state.cards) {
      for (const action of card.actions) assert.equal(action.executable, false);
    }
  });
});
