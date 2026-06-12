/**
 * tests/meta-agent-registry.test.ts — Live Organism P1: the canonical meta-agent/organ registry.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveMetaAgentRegistry, childrenOf } from "../src/agents/meta-agent-registry.js";

const REQUIRED = [
  "orchestrator", "rinnegan", "wolverine", "prophet", "executive-memory", "research", "beezulbub",
  "factory", "officiator", "simulator", "execution-engine", "fitness", "ops", "supabase", "obsidian", "cockpit",
];

describe("resolveMetaAgentRegistry", () => {
  const reg = resolveMetaAgentRegistry({ now: "2026-06-10T12:00:00Z" });

  it("includes every required agent + organ", () => {
    for (const id of REQUIRED) assert.ok(reg.byId[id], `missing ${id}`);
    assert.ok(reg.byId["hart"], "missing human root");
  });

  it("every node has the required capability fields", () => {
    for (const a of reg.agents) {
      assert.ok(a.role && a.description, `${a.id} missing role/description`);
      assert.ok(a.category, `${a.id} missing category`);
      assert.ok(["live", "partial", "local_only", "unavailable", "stale"].includes(a.status), `${a.id} bad status`);
      assert.ok(Array.isArray(a.supportedIntents) && Array.isArray(a.readOnlyCapabilities), `${a.id} missing capability arrays`);
      assert.equal(typeof a.cockpitCallable, "boolean");
      assert.equal(typeof a.cliOnly, "boolean");
      assert.equal(typeof a.requiresLocalRunner, "boolean");
    }
  });

  it("renders the org hierarchy: Hart → Orchestrator → agents; Factory → Officiator/Simulator/Execution", () => {
    assert.equal(reg.rootId, "hart");
    assert.equal(reg.byId["orchestrator"].parentId, "hart");
    const underOrch = childrenOf(reg, "orchestrator").map((a) => a.id);
    for (const id of ["rinnegan", "wolverine", "prophet", "research", "beezulbub", "factory", "fitness", "ops"]) {
      assert.ok(underOrch.includes(id), `${id} should report to orchestrator`);
    }
    const underFactory = childrenOf(reg, "factory").map((a) => a.id);
    for (const id of ["officiator", "simulator", "execution-engine"]) {
      assert.ok(underFactory.includes(id), `${id} should sit under factory`);
    }
  });

  it("shows cockpit-callable vs CLI-only honestly", () => {
    assert.equal(reg.byId["execution-engine"].cliOnly, true);
    assert.equal(reg.byId["execution-engine"].cockpitCallable, false);
    assert.equal(reg.byId["orchestrator"].cockpitCallable, true);
    assert.equal(reg.byId["beezulbub"].requiresLocalRunner, true); // live hunt needs a runner
  });

  it("ops read-model is live (the read-only RPCs resolve)", () => {
    assert.equal(reg.byId["ops"].status, "live");
    assert.match(reg.byId["ops"].statusReason, /live|read-model/i);
  });

  it("counts are consistent and the output is frozen", () => {
    assert.equal(reg.counts.total, reg.agents.length);
    assert.ok(reg.counts.cockpitCallable > 0 && reg.counts.live > 0);
    assert.throws(() => {
      (reg.agents[0] as unknown as { status: string }).status = "hacked";
    });
  });
});
