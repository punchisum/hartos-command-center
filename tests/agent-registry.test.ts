/**
 * tests/agent-registry.test.ts — Phase 11I.
 * Registry degrades safely with no config and loads a local config when present.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadAgentRegistry, LOCAL_CONFIG_FILE } from "../src/agents/agent-registry.js";

describe("agent registry", () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "agent-registry-")); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("degrades to empty/unconfigured with no config file", async () => {
    const reg = await loadAgentRegistry(dir);
    assert.equal(reg.configPresent, false);
    assert.equal(reg.configPath, null);
    assert.deepEqual(reg.agents, []);
  });

  it("loads a local config file", async () => {
    await writeFile(
      path.join(dir, LOCAL_CONFIG_FILE),
      JSON.stringify({ agents: [{ id: "ops-agent-v2", name: "Ops", type: "ops", enabled: true, repoPath: "../ops" }] }),
      "utf8"
    );
    const reg = await loadAgentRegistry(dir);
    assert.equal(reg.configPresent, true);
    assert.equal(reg.agents.length, 1);
    assert.equal(reg.agents[0]!.type, "ops");
    assert.equal(reg.agents[0]!.enabled, true);
  });

  it("tolerates a UTF-8 BOM (Windows-written config files)", async () => {
    const bom = String.fromCharCode(0xfeff);
    await writeFile(
      path.join(dir, LOCAL_CONFIG_FILE),
      bom + JSON.stringify({ agents: [{ id: "ops-agent-v2", name: "Ops", type: "ops", enabled: true, repoPath: "../ops" }] }),
      "utf8"
    );
    const reg = await loadAgentRegistry(dir);
    assert.equal(reg.agents.length, 1, "BOM-prefixed config must still parse");
  });

  it("treats invalid JSON as present-but-empty (safe degrade)", async () => {
    await writeFile(path.join(dir, LOCAL_CONFIG_FILE), "{ not json", "utf8");
    const reg = await loadAgentRegistry(dir);
    assert.equal(reg.configPresent, true);
    assert.deepEqual(reg.agents, []);
  });
});
