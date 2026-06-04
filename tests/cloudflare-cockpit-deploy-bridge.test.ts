/**
 * tests/cloudflare-cockpit-deploy-bridge.test.ts — Phase 11J.
 * Deploy bridge follows the Factory gate doctrine: blocked by default; ready only
 * when ALL gates + required env are present. Reuses ALLOW_AUTO_PROVISION.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkCockpitDeployGates, buildDeployPlan, COCKPIT_DEPLOY_GATES } from "../src/runtime/cloudflare-deploy-bridge.js";

const ALL_GATES_OPEN = {
  ALLOW_AUTO_PROVISION: "true",
  CONFIRM_CLOUDFLARE_DEPLOY: "true",
  ALLOW_CLOUDFLARE_COCKPIT_DEPLOY: "true",
  CLOUDFLARE_API_TOKEN: "present-token",
  CLOUDFLARE_ACCOUNT_ID: "present-acct",
};

describe("cloudflare cockpit deploy bridge", () => {
  it("blocks with no gates (blocked_missing_gate)", () => {
    const r = checkCockpitDeployGates({});
    assert.equal(r.status, "blocked_missing_gate");
    assert.ok(r.missingGates.includes("ALLOW_AUTO_PROVISION"));
    assert.ok(r.missingGates.includes("CONFIRM_CLOUDFLARE_DEPLOY"));
    assert.ok(r.missingGates.includes("ALLOW_CLOUDFLARE_COCKPIT_DEPLOY"));
  });

  it("reuses the Factory ALLOW_AUTO_PROVISION gate", () => {
    assert.ok((COCKPIT_DEPLOY_GATES as readonly string[]).includes("ALLOW_AUTO_PROVISION"));
  });

  it("still blocks when gates are true but required env is missing", () => {
    const r = checkCockpitDeployGates({
      ALLOW_AUTO_PROVISION: "true",
      CONFIRM_CLOUDFLARE_DEPLOY: "true",
      ALLOW_CLOUDFLARE_COCKPIT_DEPLOY: "true",
    });
    assert.equal(r.status, "blocked_missing_gate");
    assert.ok(r.missingGates.some((g) => g.includes("CLOUDFLARE_API_TOKEN")));
  });

  it("is ready only when all gates and required env are present", () => {
    const r = checkCockpitDeployGates(ALL_GATES_OPEN);
    assert.equal(r.status, "ready");
    assert.deepEqual(r.missingGates, []);
  });

  it("deploy plan reports gate status, Cloudflare Access, and no action execution", () => {
    const plan = buildDeployPlan({}, "deploy-plan");
    assert.equal(plan.gate.status, "blocked_missing_gate");
    assert.equal(plan.actionExecution, "disabled");
    assert.equal(plan.mutationEndpoints, "none");
    assert.ok(plan.cloudflareAccessRecommendation.includes("Cloudflare Access"));
    assert.ok(plan.routes.includes("GET /health"));
    assert.ok(plan.deploymentSteps.length > 0);
    assert.ok(plan.rollbackPlan.length > 0);
  });
});
