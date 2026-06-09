/**
 * tests/repair-loop.test.ts — FACTORY v1.5: the Repair-Loop CORE (PROPOSAL ONLY).
 *
 * Proves the repair loop honors the never-hide / never-launder invariants (plan §1 cap 8 + §19):
 *   - proposeRepair surfaces EVERY failing test (count matches the failure set);
 *   - validateRepairProposal REFUSES a proposal that omits a known failing test;
 *   - verificationStatus is 'blocked' (never 'verified') while any required test fails;
 *   - proposalOnly / requiresApproval / gateFlag hold as DATA;
 *   - determinism: same input ⇒ deep-equal proposal.
 * Fully HERMETIC: no env, no network, no fs, no clock — `now` is injected.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  proposeRepair,
  validateRepairProposal,
  type RepairFailureReport,
  type RepairProposal,
} from "../src/hartos/repair-loop.js";
import type { TestPlanCase } from "../src/hartos/manifest-types.js";

const NOW = "2026-06-09T12:00:00.000Z";

const FAILURES: RepairFailureReport[] = [
  { kind: "failing_test", testId: "born-agent.summary.test#renders-em-dash", detail: "expected '—', got 'undefined'" },
  { kind: "failing_test", testId: "born-agent.contract.test#zero-violations", detail: "1 violation: read-only" },
  { kind: "typecheck_error", file: "src/born/summary.ts", detail: "TS2345 amount is possibly null" },
  { kind: "gate_refusal", gate: "ALLOW_REPAIR_LOOP", detail: "gate is data-OFF; human must approve" },
];

const TEST_PLAN: TestPlanCase[] = [
  { id: "born-agent.summary.test#renders-em-dash", description: "missing → em-dash", criterion: "no fabricated amounts", hermetic: true },
  { id: "born-agent.acceptance.test#lists-all", description: "lists every invoice", criterion: "completeness", hermetic: true },
];

describe("hartos repair-loop", () => {
  it("surfaces EVERY failing test (count matches the failure set)", () => {
    const p = proposeRepair(FAILURES, { now: NOW });
    const expectedIds = FAILURES.filter((f) => f.kind === "failing_test").map((f) =>
      f.kind === "failing_test" ? f.testId : ""
    );
    assert.equal(p.failingTests.length, expectedIds.length);
    assert.deepEqual(p.failingTests, expectedIds);
    // Every failing test is also a must-pass gate.
    for (const id of p.failingTests) assert.ok(p.mustPass.includes(id));
  });

  it("verificationStatus is 'blocked' (never 'verified') while any required test fails", () => {
    const p = proposeRepair(FAILURES, { now: NOW });
    assert.equal(p.verificationStatus, "blocked");
    assert.notEqual(p.verificationStatus, "verified");
  });

  it("folds planned test-case ids into mustPass and stays blocked", () => {
    const p = proposeRepair(FAILURES, { testPlan: TEST_PLAN, now: NOW });
    // mustPass is the union of failing-test ids and planned case ids (deduped).
    assert.ok(p.mustPass.includes("born-agent.acceptance.test#lists-all"));
    for (const id of p.failingTests) assert.ok(p.mustPass.includes(id));
    // The shared id appears once.
    const shared = "born-agent.summary.test#renders-em-dash";
    assert.equal(p.mustPass.filter((id) => id === shared).length, 1);
    assert.equal(p.verificationStatus, "blocked");
  });

  it("yields a clean, 'verified' proposal only when there is nothing to verify", () => {
    const p = proposeRepair([], {});
    assert.equal(p.failingTests.length, 0);
    assert.equal(p.mustPass.length, 0);
    assert.equal(p.verificationStatus, "verified");
    assert.deepEqual(validateRepairProposal(p), []);
  });

  it("validateRepairProposal REFUSES a proposal that omits a known failing test", () => {
    const p = proposeRepair(FAILURES, { now: NOW });
    const known = "born-agent.contract.test#zero-violations";
    // Drop one surfaced failing test to simulate hiding it.
    const hidden: RepairProposal = {
      ...p,
      failingTests: p.failingTests.filter((id) => id !== known),
      mustPass: p.mustPass.filter((id) => id !== known),
    };
    const refusals = validateRepairProposal(hidden, [known]);
    assert.ok(refusals.length > 0);
    assert.ok(refusals.some((r) => r.includes(known)));
  });

  it("validateRepairProposal accepts an honest proposal that surfaces all known failures", () => {
    const p = proposeRepair(FAILURES, { now: NOW });
    const known = FAILURES.filter((f) => f.kind === "failing_test").map((f) =>
      f.kind === "failing_test" ? f.testId : ""
    );
    assert.deepEqual(validateRepairProposal(p, known), []);
  });

  it("validateRepairProposal REFUSES a laundered 'verified' status while tests still fail", () => {
    const p = proposeRepair(FAILURES, { now: NOW });
    const laundered: RepairProposal = { ...p, verificationStatus: "verified" };
    const refusals = validateRepairProposal(laundered);
    assert.ok(refusals.some((r) => r.includes("verified")));
  });

  it("carries proposalOnly / requiresApproval / gateFlag as DATA", () => {
    const p = proposeRepair(FAILURES, { now: NOW });
    assert.equal(p.proposalOnly, true);
    assert.equal(p.requiresApproval, true);
    assert.equal(p.gateFlag, "ALLOW_REPAIR_LOOP");
  });

  it("derives risk: gate refusal ⇒ high, failing test ⇒ medium, typecheck-only ⇒ low", () => {
    assert.equal(proposeRepair(FAILURES, { now: NOW }).riskLevel, "high");
    const testsOnly: RepairFailureReport[] = [
      { kind: "failing_test", testId: "t1", detail: "x" },
    ];
    assert.equal(proposeRepair(testsOnly, {}).riskLevel, "medium");
    const typeOnly: RepairFailureReport[] = [
      { kind: "typecheck_error", file: "a.ts", detail: "x" },
    ];
    assert.equal(proposeRepair(typeOnly, {}).riskLevel, "low");
  });

  it("is deterministic: same input ⇒ deep-equal proposal", () => {
    const a = proposeRepair(FAILURES, { testPlan: TEST_PLAN, now: NOW });
    const b = proposeRepair(FAILURES, { testPlan: TEST_PLAN, now: NOW });
    assert.deepEqual(a, b);
  });

  it("does not read env/network/fs/clock — injected now does not leak into output", () => {
    const a = proposeRepair(FAILURES, { now: "2020-01-01T00:00:00.000Z" });
    const b = proposeRepair(FAILURES, { now: "2099-12-31T23:59:59.999Z" });
    // Different injected timestamps ⇒ identical proposals (now never affects output).
    assert.deepEqual(a, b);
  });
});
