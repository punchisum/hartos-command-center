/**
 * tests/provisioning-plan.test.ts
 *
 * Tests for ProvisionPlan building.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildProvisionPlan, buildContext } from "../src/provisioning/plan.js";
import { MockAdapter } from "../src/provisioning/adapters/mock.js";
import { SupabaseAdapter } from "../src/provisioning/adapters/supabase.js";
import { CloudflareAdapter } from "../src/provisioning/adapters/cloudflare.js";
import type { ProvisionContext } from "../src/provisioning/types.js";

const baseContext: ProvisionContext = {
  agentName: "test-agent",
  environment: "local",
  env: {},
};

describe("buildProvisionPlan", () => {
  test("returns a plan with all steps from adapters", async () => {
    const adapters = [new MockAdapter("supabase"), new MockAdapter("cloudflare")];
    const plan = await buildProvisionPlan(baseContext, adapters);
    assert.ok(plan.steps.length >= 2, "Plan must include steps from all adapters");
  });

  test("plan has correct agent name and environment", async () => {
    const adapters = [new MockAdapter("supabase")];
    const plan = await buildProvisionPlan(baseContext, adapters);
    assert.equal(plan.agentName, "test-agent");
    assert.equal(plan.environment, "local");
  });

  test("plan has a timestamp", async () => {
    const adapters = [new MockAdapter("supabase")];
    const plan = await buildProvisionPlan(baseContext, adapters);
    assert.ok(plan.timestamp);
    assert.ok(!isNaN(Date.parse(plan.timestamp)));
  });

  test("plan counts match steps", async () => {
    const adapters = [new SupabaseAdapter(), new CloudflareAdapter()];
    const plan = await buildProvisionPlan(baseContext, adapters);
    assert.equal(plan.totalSteps, plan.mutatingSteps + plan.readOnlySteps);
    assert.equal(plan.totalSteps, plan.steps.length);
  });

  test("mutating steps have requiredGate set", async () => {
    const adapters = [new SupabaseAdapter(), new CloudflareAdapter()];
    const plan = await buildProvisionPlan(baseContext, adapters);
    const mutating = plan.steps.filter((s) => s.mutation);
    for (const step of mutating) {
      assert.ok(
        step.requiredGate,
        `Mutating step ${step.id} must have a requiredGate`
      );
    }
  });

  test("all steps have safe summaries (no secrets)", async () => {
    const adapters = [
      new SupabaseAdapter(),
      new CloudflareAdapter(),
      new MockAdapter("telegram"),
    ];
    const ctxWithEnv: ProvisionContext = {
      ...baseContext,
      env: {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "test-key",
      },
    };
    const plan = await buildProvisionPlan(ctxWithEnv, adapters);
    for (const step of plan.steps) {
      assert.ok(
        !step.safeSummary.match(/sk-[A-Za-z0-9_-]{20,}/),
        `Step ${step.id} safeSummary must not contain API key patterns`
      );
    }
  });

  test("plan with no adapters is empty", async () => {
    const plan = await buildProvisionPlan(baseContext, []);
    assert.equal(plan.totalSteps, 0);
    assert.equal(plan.mutatingSteps, 0);
    assert.equal(plan.readOnlySteps, 0);
  });

  test("all steps have 'planned' status after build", async () => {
    const adapters = [new SupabaseAdapter()];
    const plan = await buildProvisionPlan(baseContext, adapters);
    for (const step of plan.steps) {
      assert.equal(step.status, "planned");
    }
  });

  test("staging production gate is set on mutating steps when environment=production", async () => {
    const prodContext: ProvisionContext = { ...baseContext, environment: "production" };
    const adapters = [new SupabaseAdapter()];
    const plan = await buildProvisionPlan(prodContext, adapters);
    const mutating = plan.steps.filter((s) => s.mutation);
    for (const step of mutating) {
      assert.ok(
        step.productionGateRequired === true,
        `Step ${step.id} should require production gate`
      );
    }
  });
});

describe("buildContext", () => {
  test("returns a context with agentName and environment", () => {
    const ctx = buildContext("my-agent", "staging");
    assert.equal(ctx.agentName, "my-agent");
    assert.equal(ctx.environment, "staging");
  });

  test("context env comes from process.env", () => {
    const ctx = buildContext("my-agent", "local");
    assert.ok(typeof ctx.env === "object");
  });
});
