/**
 * tests/command-center-action-contract.test.ts
 *
 * Phase 11G — action contract tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_STATES,
  DANGEROUS_ACTIONS,
  MUTATION_ACTIONS,
  SAFE_STATES,
  GATED_STATES,
  getActionState,
  isDangerous,
  isSafeToExpose,
  assertNoDangerousReadOnly,
  actionsByState,
} from "../src/command-center/action-contract.js";

describe("command center action contract", () => {
  it("maps the documented action states", () => {
    assert.equal(getActionState("view_report"), "read_only");
    assert.equal(getActionState("generate_report"), "local_report_generation");
    assert.equal(getActionState("execute_provider_mutation"), "forbidden");
    assert.equal(getActionState("promote_pack"), "approval_required");
    assert.equal(getActionState("deploy_agent"), "manual_required");
  });

  it("never marks a dangerous action as read_only or local report generation", () => {
    for (const action of DANGEROUS_ACTIONS) {
      assert.ok(!SAFE_STATES.includes(getActionState(action)), `${action} must not be a safe state`);
    }
  });

  it("keeps provider/pack/deploy mutation actions gated only", () => {
    for (const action of MUTATION_ACTIONS) {
      assert.ok(GATED_STATES.includes(getActionState(action)), `${action} must be gated`);
    }
  });

  it("execute_provider_mutation is forbidden", () => {
    assert.equal(getActionState("execute_provider_mutation"), "forbidden");
    assert.ok(isDangerous("execute_provider_mutation"));
    assert.ok(!isSafeToExpose("execute_provider_mutation"));
  });

  it("view_report is safe to expose", () => {
    assert.ok(isSafeToExpose("view_report"));
    assert.ok(!isDangerous("view_report"));
  });

  it("assertNoDangerousReadOnly passes for the shipped contract", () => {
    assert.doesNotThrow(() => assertNoDangerousReadOnly());
  });

  it("partitions every action into a state bucket", () => {
    const buckets = actionsByState();
    const total = Object.values(buckets).reduce((n, list) => n + list.length, 0);
    assert.equal(total, Object.keys(ACTION_STATES).length);
  });
});
