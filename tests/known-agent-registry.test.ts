/**
 * tests/known-agent-registry.test.ts — Factory v1.5: Officiator backport (plan §1 cap 7).
 *
 * Proves resolveKnownAgents composes "which agents exist" WITHOUT mutating the static
 * AGENT_CONTRACTS literal or adding a store:
 *   - static-only passthrough (no created) ⇒ length 2 (fitness + ops);
 *   - a valid created contract is appended ⇒ length 3;
 *   - a created contract reusing an existing `.type` is deduped, static wins ⇒ length 2;
 *   - a malformed created contract (fails validateAgentContract) is dropped;
 *   - AGENT_CONTRACTS.length is NEVER changed by any call (no mutation);
 *   - determinism: same inputs ⇒ deep-equal output;
 *   - END-TO-END SEAM: feeding resolveKnownAgents([...]) into the wave-1
 *     classifyBuildRequest(req, { contracts }) yields `already_solved` for a covered
 *     domain — WITHOUT editing agent-inbox.ts.
 *
 * Fully HERMETIC: no env, no network, no fs, no clock. Pure values only.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveKnownAgents } from "../src/agents/known-agent-registry.js";
import { AGENT_CONTRACTS, type AgentContract } from "../src/agents/agent-contract.js";
import { classifyBuildRequest } from "../src/hartos/agent-inbox.js";

// A valid created agent with a NOVEL type ("other") and a generic detail spec — passes
// validateAgentContract (non-empty proposalTypes, generic detail with rpcs+columns).
const CREATED_OTHER: AgentContract = {
  type: "other",
  label: "Invoices",
  icon: "🧾",
  readModelId: "invoices",
  proposalTypes: ["invoice_followup_plan"],
  approvalRequired: true,
  detail: {
    domain: "other",
    label: "Invoices",
    urlEnv: "INVOICES_URL",
    keyEnv: "INVOICES_KEY",
    rpcs: [
      {
        rpc: "invoice_overview",
        section: "Outstanding",
        render: "table",
        columns: [{ header: "Invoice", field: "id" }],
      },
    ],
  },
};

// A created contract that collides with an existing static domain ("fitness") — itself
// valid, but must be deduped so the static FITNESS_CONTRACT wins.
const CREATED_FITNESS_DUP: AgentContract = {
  type: "fitness",
  label: "Imposter Fitness",
  icon: "🥊",
  readModelId: "fitness-fork",
  proposalTypes: ["forked_plan"],
  approvalRequired: true,
  detail: { kind: "bespoke" },
};

// Malformed: empty proposalTypes ⇒ validateAgentContract returns a violation ⇒ dropped.
const CREATED_MALFORMED: AgentContract = {
  type: "other",
  label: "Broken",
  icon: "💥",
  readModelId: "broken",
  proposalTypes: [], // <- invalid
  approvalRequired: true,
  detail: { kind: "bespoke" },
};

describe("resolveKnownAgents — composable officiation registry (Factory v1.5)", () => {
  it("static-only passthrough returns the 2 static contracts", () => {
    const known = resolveKnownAgents();
    assert.equal(known.length, 2);
    assert.deepEqual(known.map((c) => c.type).sort(), ["fitness", "ops"]);
  });

  it("appends a valid created contract (length 3)", () => {
    const known = resolveKnownAgents([CREATED_OTHER]);
    assert.equal(known.length, 3);
    assert.deepEqual(known.map((c) => c.type).sort(), ["fitness", "ops", "other"]);
    assert.equal(known.find((c) => c.type === "other")?.label, "Invoices");
  });

  it("dedupes a created contract that reuses an existing type — static wins (length 2)", () => {
    const known = resolveKnownAgents([CREATED_FITNESS_DUP]);
    assert.equal(known.length, 2);
    const fitness = known.find((c) => c.type === "fitness");
    // The STATIC fitness contract is preserved, not the created imposter.
    assert.equal(fitness?.label, "Fitness");
    assert.notEqual(fitness?.label, "Imposter Fitness");
  });

  it("drops a malformed created contract (fails validateAgentContract)", () => {
    const known = resolveKnownAgents([CREATED_MALFORMED]);
    assert.equal(known.length, 2);
    assert.deepEqual(known.map((c) => c.type).sort(), ["fitness", "ops"]);
  });

  it("processes a mixed batch — valid appended, dup deduped, malformed dropped", () => {
    const known = resolveKnownAgents([CREATED_OTHER, CREATED_FITNESS_DUP, CREATED_MALFORMED]);
    assert.equal(known.length, 3);
    assert.deepEqual(known.map((c) => c.type).sort(), ["fitness", "ops", "other"]);
    assert.equal(known.find((c) => c.type === "fitness")?.label, "Fitness");
  });

  it("NEVER mutates AGENT_CONTRACTS — length unchanged after every call", () => {
    const before = AGENT_CONTRACTS.length;
    resolveKnownAgents();
    resolveKnownAgents([CREATED_OTHER]);
    resolveKnownAgents([CREATED_FITNESS_DUP]);
    resolveKnownAgents([CREATED_MALFORMED]);
    resolveKnownAgents([CREATED_OTHER, CREATED_FITNESS_DUP, CREATED_MALFORMED]);
    assert.equal(AGENT_CONTRACTS.length, before);
    // The static fitness contract is the original literal, not a created fork.
    assert.equal(AGENT_CONTRACTS.find((c) => c.type === "fitness")?.label, "Fitness");
  });

  it("is deterministic — same inputs produce deep-equal output", () => {
    const a = resolveKnownAgents([CREATED_OTHER, CREATED_FITNESS_DUP]);
    const b = resolveKnownAgents([CREATED_OTHER, CREATED_FITNESS_DUP]);
    assert.deepEqual(a, b);
  });

  it("END-TO-END SEAM: composed registry drives classifyBuildRequest already_solved (no agent-inbox edit)", () => {
    // An ops-domain request, with the COMPOSED registry supplied. The Inbox's already_solved
    // gate reads opts.contracts (wave-1 seam) — resolveKnownAgents feeds it cleanly.
    const req = "monitor operations uptime and deployment status";
    const verdict = classifyBuildRequest(req, {
      contracts: resolveKnownAgents([CREATED_OTHER]),
    });
    assert.equal(verdict.label, "already_solved");
    assert.equal(verdict.matchedAgent, "ops");
    // Sanity: the composed list still contains the created agent (the seam carried it through).
    assert.ok(
      resolveKnownAgents([CREATED_OTHER]).some((c) => c.type === "other"),
      "composed registry should include the created contract",
    );
  });
});
