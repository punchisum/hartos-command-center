/**
 * tests/command-center-approval-contract.test.ts
 *
 * Phase 11G — approval contract tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  APPROVAL_CATEGORIES,
  APPROVAL_REASONS,
  APPROVAL_RULES,
  getApprovalCategory,
  requiresApproval,
  assertNoDangerousWithoutApproval,
} from "../src/command-center/approval-contract.js";
import { DANGEROUS_ACTIONS } from "../src/command-center/action-contract.js";

describe("command center approval contract", () => {
  it("defines all approval categories and reasons", () => {
    for (const c of ["none", "human_review", "human_approval", "admin_approval", "forbidden"]) {
      assert.ok(APPROVAL_CATEGORIES.includes(c as never), `Missing category ${c}`);
    }
    for (const r of [
      "provider_mutation",
      "supabase_mutation",
      "pack_promotion",
      "production_deploy",
      "secret_boundary",
      "third_party_code",
      "data_privacy",
      "business_critical",
    ]) {
      assert.ok(APPROVAL_REASONS.includes(r as never), `Missing reason ${r}`);
    }
  });

  it("makes provider mutation forbidden", () => {
    assert.equal(getApprovalCategory("execute_provider_mutation"), "forbidden");
  });

  it("gates pack promotion behind admin approval with pack_promotion reason", () => {
    const rule = APPROVAL_RULES["promote_pack"];
    assert.equal(rule.category, "admin_approval");
    assert.ok(rule.reasons.includes("pack_promotion"));
  });

  it("gates deploy behind human approval", () => {
    assert.equal(getApprovalCategory("deploy_agent"), "human_approval");
  });

  it("never lets a dangerous action have approval category none", () => {
    for (const action of DANGEROUS_ACTIONS) {
      assert.notEqual(getApprovalCategory(action), "none", `${action} must require approval`);
      assert.ok(requiresApproval(action), `${action} must require approval`);
    }
  });

  it("treats read-only actions as approval none", () => {
    assert.equal(getApprovalCategory("view_report"), "none");
    assert.ok(!requiresApproval("view_report"));
  });

  it("assertNoDangerousWithoutApproval passes for the shipped contract", () => {
    assert.doesNotThrow(() => assertNoDangerousWithoutApproval());
  });
});
