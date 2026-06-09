/**
 * tests/manifest-build-planner.test.ts — FACTORY v1.5: the BUILD PLANNER.
 *
 * Proves planFromManifest() projects a compiled AgentManifest (and, advisorily, a Beezulbub
 * report) into a typed ImplementationPlan that holds the Factory v1.5 invariants:
 *   - non-empty provisioningIntent / tests / deployGates / rollback;
 *   - requiresApproval === true AND every provisioning step stays UN-APPLIED (no status apply);
 *   - with a Beezulbub report: proposedFromBeezulbub === report.proposedBuildPlanChanges AND
 *     plan.confidence <= report.confidence (plan §19 — no confidence laundering);
 *   - FAIL-CLOSED: an invalid manifest (readModel.enabled=true) yields non-empty violations
 *     (and a plan is still returned, requiresApproval:true);
 *   - determinism: same manifest (+ report) ⇒ deep-equal plan.
 * Fully HERMETIC: no env, no network, no fs, no clock — `now` is injected.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planFromManifest } from "../src/hartos/manifest-build-planner.js";
import { compileSpecToManifest } from "../src/hartos/manifest-compiler.js";
import type { AgentManifest, AgentSpec } from "../src/hartos/manifest-types.js";
import type { ProvisionStep } from "../src/provisioning/types.js";
import type {
  BeezulbubCapabilityReport,
  ProposedBuildPlanChange,
} from "../src/beezulbub/types.js";

const NOW = "2026-06-09T12:00:00.000Z";

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

/** Attach a rollback to each provisioning step so the rollback projection is exercised. */
function withRollback(manifest: AgentManifest): AgentManifest {
  const steps: ProvisionStep[] = manifest.provisioning.steps.map((s) => ({
    ...s,
    rollback: { description: `Roll back ${s.id} (planning-only intent — not executed).` },
  }));
  return { ...manifest, provisioning: { ...manifest.provisioning, steps } };
}

const PROPOSED: ProposedBuildPlanChange[] = [
  { kind: "add_pattern", description: "Adopt the pagination read pattern.", derivedFrom: "repo-x", requiresApproval: true },
  { kind: "add_test", description: "Add an empty-result hermetic test.", requiresApproval: true },
];

/** A minimal Beezulbub report — only the fields the planner reads. */
function makeReport(confidence: number): BeezulbubCapabilityReport {
  return {
    reportId: "bz-report-spec-invoices-001-001",
    agentSpecId: SPEC.specId,
    searchScope: { target: "invoice read patterns", mode: "fixture" },
    candidateSources: [],
    acceptedPatterns: [],
    rejectedPatterns: [],
    licenseNotes: [],
    securityNotes: [],
    dependencyRisks: [],
    doctrineRisks: [],
    recommendedAdaptations: [
      {
        absorb: ["pagination"],
        reject: [],
        adaptSteps: ["wrap reads in a read-only cursor"],
        targetPack: "invoices-read",
        requiredTests: ["paginated read returns stable ordering", "empty result renders an em-dash"],
        requiredEnvVars: [],
        requiredProviderAdapters: [],
        requiredDbChanges: [],
        requiredSmokeChecks: [],
        securityNotes: [],
      },
    ],
    doNotUseList: [],
    confidence,
    unknowns: [],
    proposedBuildPlanChanges: PROPOSED,
    sourceLinks: [],
    auditTrail: [],
    generatedAt: NOW,
  };
}

describe("manifest build planner (Factory v1.5, plan §1 cap 4 / §18)", () => {
  it("projects a manifest into a plan with non-empty provisioningIntent / tests / deployGates / rollback", () => {
    const plan = planFromManifest(withRollback(compileSpecToManifest(SPEC)), { now: NOW });
    assert.ok(plan.provisioningIntent.length > 0);
    assert.ok(plan.tests.length > 0);
    assert.ok(plan.deployGates.length > 0);
    assert.ok(plan.rollback.length > 0);
    assert.ok(plan.files.length > 0);
    assert.ok(plan.migrations.length > 0);
    assert.equal(plan.manifestRef.specId, SPEC.specId);
    assert.equal(plan.manifestRef.agentName, SPEC.agentName);
  });

  it("requiresApproval===true and the provisioning intent stays UN-APPLIED", () => {
    const plan = planFromManifest(compileSpecToManifest(SPEC), { now: NOW });
    assert.equal(plan.requiresApproval, true);
    // un-applied: no step carries an applied/created/verified status (still planning-only).
    assert.ok(plan.provisioningIntent.every((s) => s.status === undefined));
  });

  it("deployGates derive from requiredGate + productionGateRequired (names only, deduped)", () => {
    const plan = planFromManifest(compileSpecToManifest(SPEC), { now: NOW });
    // The compiled provisioning carries the three provider gates + a production gate.
    assert.ok(plan.deployGates.includes("ALLOW_GITHUB_PROVISION"));
    assert.ok(plan.deployGates.includes("ALLOW_SUPABASE_PROVISION"));
    assert.ok(plan.deployGates.includes("ALLOW_CLOUDFLARE_COCKPIT_DEPLOY"));
    assert.ok(plan.deployGates.includes("CONFIRM_PRODUCTION_DEPLOY"));
    // deduped
    assert.equal(new Set(plan.deployGates).size, plan.deployGates.length);
  });

  it("tests cover the manifest cases by default (all from manifest, hermetic)", () => {
    const plan = planFromManifest(compileSpecToManifest(SPEC), { now: NOW });
    assert.ok(plan.tests.every((t) => t.hermetic));
    assert.ok(plan.tests.every((t) => t.source === "manifest"));
    assert.ok(plan.tests.some((t) => t.criterion === "officiable"));
  });

  it("with a Beezulbub report: proposedFromBeezulbub === report.proposedBuildPlanChanges", () => {
    const report = makeReport(0.7);
    const plan = planFromManifest(compileSpecToManifest(SPEC), { report, now: NOW });
    assert.strictEqual(plan.proposedFromBeezulbub, report.proposedBuildPlanChanges);
    assert.deepEqual(plan.proposedFromBeezulbub, PROPOSED);
    // Beezulbub-required tests are folded in as advisory intent.
    assert.ok(plan.tests.some((t) => t.source === "beezulbub"));
  });

  it("with a Beezulbub report: plan.confidence <= report.confidence (no laundering, §19)", () => {
    const report = makeReport(0.4);
    const plan = planFromManifest(compileSpecToManifest(SPEC), { report, now: NOW });
    assert.ok(plan.confidence <= report.confidence, `${plan.confidence} <= ${report.confidence}`);
    assert.equal(plan.confidence, 0.4); // clean manifest intrinsic=1, clamped down to the report
  });

  it("a clean manifest with no report plans at full intrinsic confidence", () => {
    const plan = planFromManifest(compileSpecToManifest(SPEC), { now: NOW });
    assert.deepEqual(plan.violations, []);
    assert.equal(plan.confidence, 1);
    assert.deepEqual(plan.proposedFromBeezulbub, []);
  });

  it("FAIL-CLOSED: an invalid manifest (readModel.enabled=true) yields non-empty violations", () => {
    const base = compileSpecToManifest(SPEC);
    const invalid: AgentManifest = {
      ...base,
      readModel: { ...base.readModel, enabled: true },
    };
    const plan = planFromManifest(invalid, { now: NOW });
    assert.ok(plan.violations.length > 0, JSON.stringify(plan.violations));
    assert.ok(plan.violations.some((vio) => vio.facet === "read-model"));
    // a plan is still returned, still approval-gated, with eroded confidence.
    assert.equal(plan.requiresApproval, true);
    assert.ok(plan.confidence < 1);
  });

  it("FAIL-CLOSED + report: confidence stays <= report.confidence even with violations", () => {
    const base = compileSpecToManifest(SPEC);
    const invalid: AgentManifest = { ...base, readModel: { ...base.readModel, enabled: true } };
    const report = makeReport(0.9);
    const plan = planFromManifest(invalid, { report, now: NOW });
    assert.ok(plan.confidence <= report.confidence);
  });

  it("is deterministic — same manifest (+ report) ⇒ deep-equal plan", () => {
    const a = planFromManifest(withRollback(compileSpecToManifest(SPEC)), { report: makeReport(0.6), now: NOW });
    const b = planFromManifest(withRollback(compileSpecToManifest(SPEC)), { report: makeReport(0.6), now: NOW });
    assert.deepEqual(a, b);
  });
});
