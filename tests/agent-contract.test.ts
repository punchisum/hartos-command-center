/**
 * tests/agent-contract.test.ts — Phase 1.1 conformance harness.
 *
 * Proves the two real agents (fitness, ops) formally CONFORM to the officiation
 * contract, and that the harness CATCHES the failure classes it exists to catch:
 * a raw-passthrough verdict (the Phase 0 "66 → idle" bug) and an idle verdict on
 * healthy data. This is the gate Phase 4 runs before a created agent is officiated.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_CONTRACTS,
  FITNESS_CONTRACT,
  OPS_CONTRACT,
  classifyVerdict,
  validateAgentContract,
  assertOfficiable,
  findAgentContract,
  contractDetailSpecs,
  type AgentContract,
} from "../src/agents/agent-contract.js";
import type { ReadModelSummary } from "../src/read-models/read-model-types.js";

const now = new Date("2026-06-08T08:00:00Z");
const fresh = "2026-06-08T06:00:00Z";

const healthyFitness: ReadModelSummary = {
  id: "fitness", type: "fitness", status: "ok", confidence: "high",
  lines: ["Today state resolved."], metrics: { recovery: "66", healthVitals: "HRV 55ms" },
  recommendation: "Read-only; review in the cockpit.", dataFreshness: fresh, degradedSources: [],
};
const healthyOps: ReadModelSummary = {
  id: "ops", type: "ops", status: "ok", confidence: "high",
  lines: ["Active 8 (urgent 2)."], metrics: { activeCards: 8, urgentCards: 2, blockedCards: 0, waitingCards: 1, staleCards: 0 },
  recommendation: "Read-only; review in the cockpit.", dataFreshness: fresh, degradedSources: [],
};

describe("agent contract — classifyVerdict (verdict vocabulary)", () => {
  it("bands recognized recovery/ops words", () => {
    assert.equal(classifyVerdict("green"), "green");
    assert.equal(classifyVerdict("amber"), "amber");
    assert.equal(classifyVerdict("red"), "red");
    assert.equal(classifyVerdict("urgent"), "red");
    assert.equal(classifyVerdict("clear"), "green");
    assert.equal(classifyVerdict("waiting"), "amber");
    assert.equal(classifyVerdict("stale"), "amber");
  });
  it("flags honest idle states distinctly from raw passthroughs", () => {
    assert.equal(classifyVerdict("unknown"), "idle");
    assert.equal(classifyVerdict("disabled"), "idle");
    // the bug class: a bare number / arbitrary value is NOT a tone-legible band
    assert.equal(classifyVerdict("66"), "unrecognized");
    assert.equal(classifyVerdict("n/a"), "unrecognized");
  });
});

describe("agent contract — fitness + ops conform", () => {
  it("every registered contract passes static validation", () => {
    for (const c of AGENT_CONTRACTS) {
      assert.deepEqual(validateAgentContract(c), [], `${c.type} should validate`);
    }
  });

  it("fitness is officiable on healthy data (recovery 66 → amber, not idle)", () => {
    const violations = assertOfficiable(FITNESS_CONTRACT, healthyFitness, { now });
    assert.deepEqual(violations, [], JSON.stringify(violations));
  });

  it("ops is officiable on healthy data (urgent → red; approval matches)", () => {
    const violations = assertOfficiable(OPS_CONTRACT, healthyOps, { now });
    assert.deepEqual(violations, [], JSON.stringify(violations));
  });

  it("findAgentContract + contractDetailSpecs (both bespoke → no generic specs yet)", () => {
    assert.equal(findAgentContract("fitness"), FITNESS_CONTRACT);
    assert.equal(findAgentContract("nope"), undefined);
    assert.deepEqual(contractDetailSpecs(), []);
  });
});

describe("agent contract — the harness catches what it exists to catch", () => {
  it("catches an idle verdict on healthy data (junk recovery → unknown)", () => {
    const junk: ReadModelSummary = { ...healthyFitness, metrics: { recovery: "n/a" } };
    const violations = assertOfficiable(FITNESS_CONTRACT, junk, { now });
    assert.ok(violations.some((v) => v.facet === "signal"), "should flag a non-banded signal");
  });

  it("catches a generic detail spec with no rpcs", () => {
    const bad: AgentContract = {
      type: "other", label: "X", icon: "🤖", readModelId: "x", proposalTypes: ["x_plan"], approvalRequired: false,
      detail: { domain: "x", label: "X", urlEnv: "U", keyEnv: "K", rpcs: [] },
    };
    assert.ok(validateAgentContract(bad).some((v) => v.facet === "detail"));
  });

  it("catches an approval-intent mismatch", () => {
    const mismatched: AgentContract = { ...OPS_CONTRACT, approvalRequired: false };
    const violations = assertOfficiable(mismatched, healthyOps, { now });
    assert.ok(violations.some((v) => v.facet === "approval"));
  });
});
