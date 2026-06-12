/**
 * tests/agent-build-gate.test.ts — the spec-interrogation gate before agent-building.
 * Raw agent-builds are refused (with required questions); spec-locked + non-builds pass.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAgentBuildTask, gateAgentBuild } from "../src/execution/agent-build-gate.js";

describe("isAgentBuildTask", () => {
  it("detects agent-build phrasings", () => {
    assert.equal(isAgentBuildTask("build a crypto portfolio agent"), true);
    assert.equal(isAgentBuildTask("create an agent for tax filing"), true);
    assert.equal(isAgentBuildTask("scaffold a new agent for shipments"), true);
    assert.equal(isAgentBuildTask("spin up an agent that watches my watchlist"), true);
  });
  it("does not flag ordinary code tasks", () => {
    assert.equal(isAgentBuildTask("add a null check to foo.ts"), false);
    assert.equal(isAgentBuildTask("apply the Wolverine fix for dead code"), false);
    assert.equal(isAgentBuildTask("update the dashboard layout component"), false);
  });
});

describe("gateAgentBuild", () => {
  it("allows non-agent-build tasks (the executor proceeds)", () => {
    const g = gateAgentBuild("apply the Wolverine fix for 2 dead exports");
    assert.equal(g.allowed, true);
    assert.deepEqual(g.questions, []);
  });

  it("allows a spec-locked agent build — Factory interrogation already passed", () => {
    const g = gateAgentBuild("[SPEC-LOCKED] build the tax agent per the locked AgentSpec");
    assert.equal(g.allowed, true);
    assert.match(g.reason, /spec-locked/i);
  });

  it("REFUSES a raw agent-build and surfaces the required interrogation questions", () => {
    const g = gateAgentBuild("build a crypto portfolio agent");
    assert.equal(g.allowed, false);
    assert.match(g.reason, /interrogat/i);
    assert.ok(g.questions.length > 0, "must surface required spec questions for Hart to answer");
    assert.ok(g.questions.every((q) => typeof q === "string" && q.length > 0));
  });
});
