/**
 * tests/control-surface-lifecycle.test.ts
 *
 * Phase 18E — the Builder lifecycle stepper (brief test #8). The stepper reads the
 * proposal's REAL status (never hardcoded): runtime_provisioned → 6/7 done,
 * "Registered" pending.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildLifecycleSteps, completedStageCount } from "../src/cockpit/control-surface/index.js";

describe("18E — lifecycle stepper reads proposal status (test #8)", () => {
  it("runtime_provisioned → 6 of 7 steps done, Registered pending", () => {
    const steps = buildLifecycleSteps("runtime_provisioned");
    assert.equal(steps.length, 7);
    assert.equal(steps.filter((s) => s.state === "done").length, 6);
    const registered = steps.find((s) => s.label === "Registered")!;
    assert.equal(registered.state, "pending"); // terminal state — Registered is a future Phase-19 concern
    assert.equal(steps.filter((s) => s.state === "now").length, 0, "terminal state has no active frontier");
    assert.equal(completedStageCount("runtime_provisioned"), 6);
  });

  it("draft → Plan done, Approved is the frontier", () => {
    const steps = buildLifecycleSteps("draft");
    assert.equal(steps[0]!.label, "Plan");
    assert.equal(steps[0]!.state, "done");
    assert.equal(steps[1]!.label, "Approved");
    assert.equal(steps[1]!.state, "now");
    assert.equal(steps.filter((s) => s.state === "done").length, 1);
  });

  it("approved_for_execution advances with audit evidence (PR opened → 4 done)", () => {
    const steps = buildLifecycleSteps("approved_for_execution", [
      { event: "local_scaffold_built" },
      { event: "github_pr_opened" },
    ]);
    assert.equal(steps.filter((s) => s.state === "done").length, 4);
    assert.equal(steps[4]!.label, "Data Applied");
    assert.equal(steps[4]!.state, "now");
  });

  it("approved_for_execution with data applied → 5 done (Runtime Provisioned is the frontier)", () => {
    const steps = buildLifecycleSteps("approved_for_execution", [
      { event: "local_scaffold_built" },
      { event: "github_pr_opened" },
      { event: "data_provision_applied" },
    ]);
    assert.equal(steps.filter((s) => s.state === "done").length, 5);
    assert.equal(steps[5]!.label, "Runtime Provisioned");
    assert.equal(steps[5]!.state, "now");
  });
});
