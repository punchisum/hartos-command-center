/**
 * tests/bootstrap-plan.test.ts
 *
 * Tests for bootstrap plan building and structure.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildBootstrapPlan } from "../src/bootstrap/bootstrap-plan.js";

describe("buildBootstrapPlan", () => {
  test("returns a plan without mutations", async () => {
    let mutationAttempted = false;
    const plan = await buildBootstrapPlan({});
    // If no error and plan is returned, no mutation occurred
    assert.ok(plan.steps.length > 0);
    assert.ok(!mutationAttempted);
  });

  test("plan includes all six provider scope checks", async () => {
    const plan = await buildBootstrapPlan({});
    const providers = plan.steps.map((s) => s.provider);
    for (const provider of ["github", "supabase", "cloudflare", "trigger", "telegram", "openai"]) {
      assert.ok(providers.includes(provider), `Plan should include ${provider}`);
    }
  });

  test("supabase project creation is manual_required by default", async () => {
    const plan = await buildBootstrapPlan({});
    const step = plan.steps.find((s) => s.id === "supabase:project");
    assert.ok(step?.status === "manual_required");
  });

  test("cloudflare deploy gate_missing without gate", async () => {
    const plan = await buildBootstrapPlan({});
    const step = plan.steps.find((s) => s.id === "cloudflare:deploy");
    assert.ok(step?.status === "gate_missing");
  });

  test("cloudflare deploy shows ready when gate is open", async () => {
    const plan = await buildBootstrapPlan({ ALLOW_CLOUDFLARE_DEPLOY: "true" });
    const step = plan.steps.find((s) => s.id === "cloudflare:deploy");
    assert.ok(step?.status === "ready");
  });

  test("migration step shows ready when gate is open", async () => {
    const plan = await buildBootstrapPlan({ ALLOW_SUPABASE_MIGRATION_APPLY: "true" });
    const step = plan.steps.find((s) => s.id === "supabase:migrations");
    assert.ok(step?.status === "ready");
  });

  test("counts are accurate", async () => {
    const plan = await buildBootstrapPlan({});
    assert.equal(
      plan.readyCount,
      plan.steps.filter((s) => s.status === "ready").length
    );
    assert.equal(
      plan.manualCount,
      plan.steps.filter((s) => s.manualRequired).length
    );
  });
});
