/**
 * tests/officiator-quality-gate.test.ts — the Officiator quality gate (ADMIT/REVISE/REJECT).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessAgentQuality, type OfficiationInput } from "../src/hartos/officiator-quality-gate.js";
import type { AgentManifest } from "../src/hartos/manifest-types.js";
import type { AgentContract } from "../src/agents/agent-contract.js";

const OK: OfficiationInput = { officiated: true, violations: [] };

/** Minimal manifest covering only the fields the gate reads (cast — not a full compile). */
function manifest(over: Record<string, unknown> = {}): AgentManifest {
  return {
    spec: { acceptanceCriteria: ["does X"], failureMode: "fails loudly + honestly", riskLevel: "low", approvalRequired: true },
    contract: { type: "invoices", readModelId: "invoices" },
    readModel: { type: "invoices" },
    testPlan: { cases: [{ id: "t1", description: "x", criterion: "does X", hermetic: true }], acceptanceCriteria: ["does X"] },
    doctrine: { clauses: [{ id: "read-only" }] },
    jobLifecycle: { boundary: { allow: ["read"] }, jobType: "monitor", stages: [] },
    ...over,
  } as unknown as AgentManifest;
}

describe("assessAgentQuality", () => {
  it("ADMITs a complete, officiable, unique agent", () => {
    const v = assessAgentQuality(manifest(), OK, []);
    assert.equal(v.rating, "ADMIT");
    assert.equal(v.admit, true);
    assert.equal(v.score, 100);
  });

  it("REJECTs when the contract is not officiable", () => {
    const v = assessAgentQuality(manifest(), { officiated: false, violations: ["card: missing"] }, []);
    assert.equal(v.rating, "REJECT");
  });

  it("REJECTs when there are no test cases", () => {
    const v = assessAgentQuality(manifest({ testPlan: { cases: [], acceptanceCriteria: [] } }), OK, []);
    assert.equal(v.rating, "REJECT");
    assert.ok(v.facets.some((f) => f.facet === "tests" && f.status === "fail"));
  });

  it("REVISEs (not reject) on non-hermetic tests / no failure mode", () => {
    const v = assessAgentQuality(
      manifest({ testPlan: { cases: [{ id: "t1", description: "x", criterion: "c", hermetic: false }], acceptanceCriteria: ["c"] } }),
      OK,
      [],
    );
    assert.equal(v.rating, "REVISE");
  });

  it("REJECTs a duplicate agent type", () => {
    const fleet: AgentContract[] = [{ type: "invoices", readModelId: "invoices" } as unknown as AgentContract];
    const v = assessAgentQuality(manifest(), OK, fleet);
    assert.equal(v.rating, "REJECT");
    assert.ok(v.facets.some((f) => f.facet === "uniqueness" && f.status === "fail"));
  });

  it("warns on a high-risk agent that does not gate on approval", () => {
    const v = assessAgentQuality(manifest({ spec: { acceptanceCriteria: ["x"], failureMode: "f", riskLevel: "high", approvalRequired: false } }), OK, []);
    assert.equal(v.rating, "REVISE");
    assert.ok(v.facets.some((f) => f.facet === "risk_gate" && f.status === "warn"));
  });
});
