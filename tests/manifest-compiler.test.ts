/**
 * tests/manifest-compiler.test.ts — LEVEL 1 (Factory Agent v1): the MANIFEST COMPILER.
 *
 * Proves the compiler turns an APPROVED AgentSpec into an AgentManifest of KNOWN RUNTIME
 * PATTERNS (config, not code) that holds the Factory v1 invariants:
 *   - manifest.contract passes validateAgentContract with zero violations;
 *   - the born read-model is enabled:false + forbiddenOperations deep-equals
 *     FORBIDDEN_OPERATIONS (read-only born);
 *   - a JobLifecycleConfig with an empty BoundaryDefinition is REFUSED (no boundaries = no job);
 *   - DoctrineConfig.version === DOCTRINE_VERSION;
 *   - OFFICIABILITY PROOF: manifest.contract + a representative HEALTHY summary fed into the
 *     REAL officiateAgent() officiates with zero violations (single officiation vocabulary);
 *   - determinism: same spec ⇒ deep-equal manifest.
 * Fully HERMETIC: no env, no network, no fs, no clock — `now` is injected.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compileSpecToManifest, validateManifest } from "../src/hartos/manifest-compiler.js";
import type { AgentSpec } from "../src/hartos/manifest-types.js";
import { validateAgentContract } from "../src/agents/agent-contract.js";
import { officiateAgent } from "../src/agents/officiation.js";
import { FORBIDDEN_OPERATIONS, type ReadModelSummary } from "../src/read-models/read-model-types.js";
import { DOCTRINE_VERSION } from "../src/doctrine/doctrine.js";
import type { BoundaryDefinition } from "../src/research/agent-job-types.js";

const NOW = new Date("2026-06-09T12:00:00.000Z");
const FRESH = "2026-06-09T10:00:00.000Z";

const SPEC: AgentSpec = {
  specId: "spec-invoices-001",
  agentName: "invoices-agent",
  domain: "finance",
  targetReadModelType: "other",
  purpose: "Surface outstanding invoices and propose follow-ups.",
  dataSources: ["invoice_overview", "aging_buckets"],
  capabilities: ["summarize outstanding", "flag overdue"],
  label: "Invoices",
  icon: "🧾",
  proposalTypes: ["invoice_followup_plan"],
  outputs: [
    { id: "summary", kind: "cockpit exec summary", targetFolder: "reports/invoices", description: "the cockpit summary" },
  ],
  jobType: "monitoring",
  boundary: {
    maxFilesWritten: 2,
    targetFolder: "reports/invoices",
    stopConditions: ["stop when all open invoices are summarized"],
  },
  acceptanceCriteria: [
    "lists every outstanding invoice with an honest amount",
    "never fabricates an amount — a missing value renders as an em-dash",
  ],
  riskLevel: "high",
  prereqs: ["Supabase project exists", "read-only invoice RPCs deployed"],
  cockpitDone: true,
  approvalRequired: false,
  failureMode: "boundary_exceeded",
};

/** A representative HEALTHY summary for the born agent's read-model type. */
const healthySummary: ReadModelSummary = {
  id: "other",
  type: "other",
  status: "ok",
  confidence: "high",
  lines: ["Invoices resolved."],
  metrics: { outstanding: 3 },
  recommendation: "Read-only; review in the cockpit.",
  dataFreshness: FRESH,
  degradedSources: [],
};

describe("manifest compiler (Factory v1, plan §1 cap 3 / §6)", () => {
  it("compiles a spec into a clean manifest — validateManifest === []", () => {
    const m = compileSpecToManifest(SPEC);
    assert.deepEqual(validateManifest(m), []);
  });

  it("manifest.contract passes validateAgentContract with zero violations", () => {
    const m = compileSpecToManifest(SPEC);
    assert.deepEqual(validateAgentContract(m.contract), []);
  });

  it("the born read-model is read-only: enabled===false + forbiddenOperations deep-equals FORBIDDEN_OPERATIONS", () => {
    const m = compileSpecToManifest(SPEC);
    assert.equal(m.readModel.enabled, false);
    assert.deepEqual(m.readModel.forbiddenOperations, [...FORBIDDEN_OPERATIONS]);
    assert.equal(m.readModel.mode, "supabase_readonly");
  });

  it("the cockpit registration is DERIVED from the contract (single vocabulary)", () => {
    const m = compileSpecToManifest(SPEC);
    assert.equal(m.cockpitRegistration.type, m.contract.type);
    assert.equal(m.cockpitRegistration.label, m.contract.label);
    assert.equal(m.cockpitRegistration.detailRoute, `/agent/${m.contract.type}/ui`);
    assert.deepEqual(m.cockpitRegistration.proposalTypes, m.contract.proposalTypes);
    assert.equal(m.cockpitRegistration.approvalRequired, m.contract.approvalRequired);
  });

  it("DoctrineConfig.version === DOCTRINE_VERSION (refuses drift) + carries clauses", () => {
    const m = compileSpecToManifest(SPEC);
    assert.equal(m.doctrine.version, DOCTRINE_VERSION);
    assert.ok(m.doctrine.clauses.length > 0);
  });

  it("REFUSES a JobLifecycleConfig with an empty BoundaryDefinition (no boundaries = no job)", () => {
    const emptyBoundary: BoundaryDefinition = { stopConditions: [] };
    const m = compileSpecToManifest({ ...SPEC, boundary: emptyBoundary });
    const violations = validateManifest(m);
    assert.ok(violations.some((vio) => vio.facet === "job-lifecycle"), JSON.stringify(violations));
  });

  it("OFFICIABILITY PROOF: manifest.contract officiates via the REAL officiateAgent() with zero violations", () => {
    const m = compileSpecToManifest(SPEC);
    const result = officiateAgent(m.contract, healthySummary, { now: NOW });
    assert.equal(result.officiated, true, JSON.stringify(result.violations));
    assert.deepEqual(result.violations, []);
    assert.deepEqual(result.card, { label: SPEC.label, icon: SPEC.icon });
    assert.equal(result.detailRoute, `/agent/${SPEC.targetReadModelType}/ui`);
  });

  it("an approval-gated spec also officiates (approval is contract-driven)", () => {
    const m = compileSpecToManifest({ ...SPEC, approvalRequired: true });
    const result = officiateAgent(m.contract, healthySummary, { now: NOW });
    assert.equal(result.officiated, true, JSON.stringify(result.violations));
    assert.equal(result.approvalRequired, true);
  });

  it("emits a TestPlan covering the acceptance criteria + the officiation proof case", () => {
    const m = compileSpecToManifest(SPEC);
    assert.deepEqual(m.testPlan.acceptanceCriteria, SPEC.acceptanceCriteria);
    assert.ok(m.testPlan.cases.length >= SPEC.acceptanceCriteria.length + 1);
    assert.ok(m.testPlan.cases.some((c) => c.criterion === "officiable"));
    assert.ok(m.testPlan.cases.every((c) => c.hermetic));
  });

  it("emits a PLANNING-ONLY ProvisioningPlan (intent, requiresApproval:true, no apply)", () => {
    const m = compileSpecToManifest(SPEC);
    assert.equal(m.provisioning.requiresApproval, true);
    assert.ok(m.provisioning.steps.length > 0);
    assert.ok(m.provisioning.providers.length > 0);
    // planning-only intent — every step is declared mutation but carries a gate, never an apply().
    assert.ok(m.provisioning.steps.every((s) => typeof s.requiredGate === "string"));
  });

  it("is deterministic — same spec ⇒ deep-equal manifest", () => {
    assert.deepEqual(compileSpecToManifest(SPEC), compileSpecToManifest(SPEC));
  });
});
