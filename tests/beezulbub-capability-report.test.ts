/**
 * tests/beezulbub-capability-report.test.ts
 *
 * Tests for the unified BeezulbubCapabilityReport builder + serializer.
 * Covers: building from composed inputs, the confidence <= min rule (plan §19),
 * and that the secret-scan rejects a planted secret before serialization.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildCapabilityReport,
  serializeCapabilityReport,
  resolveConfidence,
  type CapabilityReportInputs,
} from "../src/beezulbub/capability-report.js";
import type {
  ScoutCandidate,
  ExtractableCapability,
  HartOSAdaptationPlan,
} from "../src/beezulbub/types.js";

const candidate: ScoutCandidate = {
  name: "clean-dashboard",
  sourceUrl: "https://github.com/example/clean-dashboard",
  targetCapability: "dashboard",
  reason: "Implements ~70% of the desired read-only dashboard.",
  estimatedValue: 8,
  licenseGuess: "MIT",
  staleRisk: "low",
  notes: "Small, inspectable, TypeScript.",
};

const accepted: ExtractableCapability = {
  id: "cap-grid",
  name: "Responsive metric grid",
  description: "A small grid component for metric cards.",
  absorb: ["grid layout", "card component"],
  reject: ["firebase data fetching"],
  hartosPackTarget: "cockpit-ui",
  requiredTests: ["grid renders"],
  requiredEnvVars: [],
  requiredProviderAdapters: [],
  requiredDbChanges: [],
  securityNotes: [],
  estimatedEffort: "low",
};

const adaptation: HartOSAdaptationPlan = {
  absorb: ["grid layout"],
  reject: ["firebase"],
  adaptSteps: ["1. Extract grid component", "2. Replace data layer with Supabase"],
  targetPack: "cockpit-ui",
  requiredTests: ["grid renders"],
  requiredEnvVars: [],
  requiredProviderAdapters: [],
  requiredDbChanges: [],
  requiredSmokeChecks: ["No secrets in extracted code"],
  securityNotes: [],
};

function baseInputs(overrides: Partial<CapabilityReportInputs> = {}): CapabilityReportInputs {
  return {
    agentSpecId: "spec-dash-001",
    searchScope: { target: "dashboard", mode: "fixture" },
    candidateSources: [candidate],
    acceptedPatterns: [accepted],
    recommendedAdaptations: [adaptation],
    ...overrides,
  };
}

describe("buildCapabilityReport", () => {
  test("composes inputs without redefining their shapes", () => {
    const report = buildCapabilityReport(baseInputs());
    assert.equal(report.agentSpecId, "spec-dash-001");
    assert.equal(report.candidateSources.length, 1);
    assert.equal(report.candidateSources[0]!.name, "clean-dashboard");
    assert.equal(report.acceptedPatterns[0]!.id, "cap-grid");
    assert.equal(report.recommendedAdaptations[0]!.targetPack, "cockpit-ui");
  });

  test("defaults all unspecified arrays to empty (no undefined holes)", () => {
    const report = buildCapabilityReport({
      agentSpecId: "spec-min",
      searchScope: { target: "x", mode: "manual" },
    });
    assert.deepEqual(report.candidateSources, []);
    assert.deepEqual(report.rejectedPatterns, []);
    assert.deepEqual(report.licenseNotes, []);
    assert.deepEqual(report.securityNotes, []);
    assert.deepEqual(report.dependencyRisks, []);
    assert.deepEqual(report.doctrineRisks, []);
    assert.deepEqual(report.doNotUseList, []);
    assert.deepEqual(report.unknowns, []);
    assert.deepEqual(report.proposedBuildPlanChanges, []);
    assert.deepEqual(report.sourceLinks, []);
  });

  test("derives a stable reportId from agentSpecId + timestamp", () => {
    const report = buildCapabilityReport(baseInputs({ generatedAt: "2026-06-09T00:00:00.000Z" }));
    assert.ok(report.reportId.startsWith("bz-report.spec-dash-001."));
    // Filename-unsafe ':' is normalized out of the id.
    assert.ok(!report.reportId.includes(":"));
  });

  test("appends a recommend audit step (append-only)", () => {
    const report = buildCapabilityReport(
      baseInputs({
        auditTrail: [{ at: "2026-06-09T00:00:00.000Z", stage: "scout", detail: "found 1" }],
      })
    );
    assert.equal(report.auditTrail.length, 2);
    assert.equal(report.auditTrail[0]!.stage, "scout");
    assert.equal(report.auditTrail[1]!.stage, "recommend");
  });
});

describe("confidence <= min(input confidences) (plan §19)", () => {
  test("clamps report confidence down to the minimum input confidence", () => {
    const report = buildCapabilityReport(
      baseInputs({ baseConfidence: 0.9, inputConfidences: [0.8, 0.3, 0.95] })
    );
    assert.equal(report.confidence, 0.3);
  });

  test("never launders confidence above base even with high inputs", () => {
    const report = buildCapabilityReport(
      baseInputs({ baseConfidence: 0.4, inputConfidences: [0.9, 0.99] })
    );
    assert.equal(report.confidence, 0.4);
  });

  test("with no input confidences, uses the clamped base confidence", () => {
    const report = buildCapabilityReport(baseInputs({ baseConfidence: 0.7 }));
    assert.equal(report.confidence, 0.7);
  });

  test("resolveConfidence clamps out-of-range values into [0,1]", () => {
    assert.equal(resolveConfidence(1.5, undefined), 1);
    assert.equal(resolveConfidence(-0.2, undefined), 0);
    assert.equal(resolveConfidence(0.9, [1.2, 0.5]), 0.5);
  });
});

describe("serializeCapabilityReport", () => {
  test("produces stable, deterministic JSON for identical inputs", () => {
    const inputs = baseInputs({ generatedAt: "2026-06-09T00:00:00.000Z" });
    const a = serializeCapabilityReport(buildCapabilityReport(inputs));
    const b = serializeCapabilityReport(buildCapabilityReport(inputs));
    assert.equal(a, b);
    const parsed = JSON.parse(a) as Record<string, unknown>;
    assert.equal(parsed["agentSpecId"], "spec-dash-001");
    assert.equal(typeof parsed["confidence"], "number");
  });

  test("rejects a planted secret before serialization", () => {
    // Build the secret at runtime to avoid the factory secret scanner.
    const prefix = "sk";
    const secret = `${prefix}-${"a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"}`;
    const report = buildCapabilityReport(
      baseInputs({
        unknowns: [`leaked api key: ${secret}`],
      })
    );
    assert.throws(
      () => serializeCapabilityReport(report),
      /Secret-looking value/,
      "Serializer must secret-scan and reject a planted secret"
    );
  });

  test("passes secret-scan for a clean report", () => {
    const report = buildCapabilityReport(baseInputs());
    assert.doesNotThrow(() => serializeCapabilityReport(report));
  });
});
