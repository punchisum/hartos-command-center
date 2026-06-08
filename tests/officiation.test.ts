/**
 * tests/officiation.test.ts — Phase 4.2.
 * A declared agent is officiated ONLY when it earns the full 7-point contract; a SAMPLE
 * created agent (the factory's output) auto-officiates; a contract violation is refused.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { officiateAgent, officiateRegistered } from "../src/agents/officiation.js";
import { FITNESS_CONTRACT, OPS_CONTRACT, type AgentContract } from "../src/agents/agent-contract.js";
import type { ReadModelSummary } from "../src/read-models/read-model-types.js";

const now = new Date("2026-06-08T08:00:00Z");
const fresh = "2026-06-08T06:00:00Z";

const healthyFitness: ReadModelSummary = { id: "fitness", type: "fitness", status: "ok", confidence: "high", lines: ["x"], metrics: { recovery: "72" }, recommendation: "read-only", dataFreshness: fresh, degradedSources: [] };
const healthyOps: ReadModelSummary = { id: "ops", type: "ops", status: "ok", confidence: "high", lines: ["x"], metrics: { urgentCards: 2 }, recommendation: "read-only", dataFreshness: fresh, degradedSources: [] };

// A SAMPLE created agent — what the Factory (Phase 4.1) emits from the monitoring archetype:
// a generic, advisory agent declared purely as data (contract + a generic detail spec).
const createdAgent: AgentContract = {
  type: "other",
  label: "Invoices",
  icon: "🧾",
  readModelId: "invoices",
  proposalTypes: ["invoice_followup_plan"],
  approvalRequired: false,
  detail: {
    domain: "invoices", label: "Invoices", urlEnv: "INVOICES_URL", keyEnv: "INVOICES_KEY",
    rpcs: [{ rpc: "get_invoice_overview", section: "Overview", render: "kv", columns: [{ header: "Outstanding", field: "outstanding" }] }],
  },
};
const healthyCreated: ReadModelSummary = { id: "invoices", type: "other", status: "ok", confidence: "high", lines: ["Invoices resolved."], metrics: { outstanding: 3 }, recommendation: "read-only", dataFreshness: fresh, degradedSources: [] };

describe("agent officiation (4.2)", () => {
  it("the real agents officiate (fitness + ops)", () => {
    assert.equal(officiateAgent(FITNESS_CONTRACT, healthyFitness, { now }).officiated, true);
    assert.equal(officiateAgent(OPS_CONTRACT, healthyOps, { now }).officiated, true);
  });

  it("a SAMPLE created agent auto-officiates — earns a fleet card, a detail route, a propose-only vocab", () => {
    const r = officiateAgent(createdAgent, healthyCreated, { now });
    assert.equal(r.officiated, true, JSON.stringify(r.violations));
    assert.deepEqual(r.card, { label: "Invoices", icon: "🧾" });
    assert.equal(r.detailRoute, "/agent/other/ui");
    assert.deepEqual(r.proposalTypes, ["invoice_followup_plan"]);
    assert.equal(r.approvalRequired, false);
  });

  it("an APPROVAL-GATED created agent officiates (approval is contract-driven, not ops-only)", () => {
    // Previously a non-ops agent that declared approvalRequired:true was refused (the signal
    // hardcoded approval to ops). It now officiates — the contract drives approval intent.
    const gated: AgentContract = { ...createdAgent, approvalRequired: true };
    const r = officiateAgent(gated, healthyCreated, { now });
    assert.equal(r.officiated, true, JSON.stringify(r.violations));
    assert.equal(r.approvalRequired, true);
  });

  it("refuses an agent that violates the contract (a generic detail spec with no rpcs)", () => {
    const broken: AgentContract = { ...createdAgent, detail: { domain: "x", label: "X", urlEnv: "U", keyEnv: "K", rpcs: [] } };
    const r = officiateAgent(broken, healthyCreated, { now });
    assert.equal(r.officiated, false);
    assert.ok(r.violations.some((v) => v.facet === "detail"));
  });

  it("refuses an agent whose representative read can't speak (missing/degraded → not officiable)", () => {
    const cantSpeak: ReadModelSummary = { ...healthyCreated, status: "missing", confidence: "low", metrics: {} };
    const r = officiateAgent(createdAgent, cantSpeak, { now });
    assert.equal(r.officiated, false);
    assert.ok(r.violations.length > 0);
  });

  it("officiateRegistered officiates every registered contract that has a sample", () => {
    const results = officiateRegistered({ fitness: healthyFitness, ops: healthyOps }, { now });
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.officiated));
  });
});
