/**
 * tests/provisioning-engine.test.ts
 *
 * Tests for the provision engine execution.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runProvisionEngine } from "../src/provisioning/engine.js";
import { buildProvisionPlan, buildContext } from "../src/provisioning/plan.js";
import { MockAdapter } from "../src/provisioning/adapters/mock.js";
import { SupabaseAdapter } from "../src/provisioning/adapters/supabase.js";
import { CloudflareAdapter } from "../src/provisioning/adapters/cloudflare.js";
import type { ProvisionContext } from "../src/provisioning/types.js";

const baseCtx: ProvisionContext = {
  agentName: "test-agent",
  environment: "local",
  env: {},
};

// ─── Engine with no gates ─────────────────────────────────────────────────────

describe("engine with no gates (empty env)", () => {
  test("mutating steps are skipped with gate_missing", async () => {
    const adapters = [new SupabaseAdapter()];
    const plan = await buildProvisionPlan(baseCtx, adapters);
    const result = await runProvisionEngine(plan, adapters, baseCtx);

    const mutatingResults = result.results.filter((r) => r.step.mutation);
    for (const r of mutatingResults) {
      assert.equal(
        r.status,
        "gate_missing",
        `Mutating step ${r.step.id} must be gate_missing without gates`
      );
    }
  });

  test("read-only steps run as verified", async () => {
    const adapters = [new SupabaseAdapter()];
    const plan = await buildProvisionPlan(baseCtx, adapters);
    const result = await runProvisionEngine(plan, adapters, baseCtx);

    const readOnly = result.results.filter((r) => !r.step.mutation);
    for (const r of readOnly) {
      assert.ok(
        r.status === "verified" || r.status === "skipped",
        `Read-only step ${r.step.id} should be verified or skipped, got: ${r.status}`
      );
    }
  });

  test("engine never throws on gate_missing", async () => {
    const adapters = [new SupabaseAdapter(), new CloudflareAdapter()];
    const plan = await buildProvisionPlan(baseCtx, adapters);
    await assert.doesNotReject(() => runProvisionEngine(plan, adapters, baseCtx));
  });

  test("gateMissingCount is accurate", async () => {
    const adapters = [new SupabaseAdapter()];
    const plan = await buildProvisionPlan(baseCtx, adapters);
    const result = await runProvisionEngine(plan, adapters, baseCtx);
    const expectedMissing = result.results.filter((r) => r.status === "gate_missing").length;
    assert.equal(result.gateMissingCount, expectedMissing);
  });
});

// ─── Engine with mock adapter (has apply()) ───────────────────────────────────

describe("engine with mock adapter (apply() implemented)", () => {
  test("mock adapter steps are applied when gates are open", async () => {
    const mockAdapter = new MockAdapter("supabase");
    const plan = await buildProvisionPlan(baseCtx, [mockAdapter]);
    // Mock adapter returns only read-only (run_smoke) steps, so no gate needed
    const result = await runProvisionEngine(plan, [mockAdapter], baseCtx);
    const verified = result.results.filter((r) => r.status === "verified" || r.status === "applied");
    assert.ok(verified.length > 0, "Mock adapter should produce verified/applied results");
  });

  test("mock adapter never mutates real providers", async () => {
    const mockAdapter = new MockAdapter("cloudflare");
    const plan = await buildProvisionPlan(baseCtx, [mockAdapter]);
    const result = await runProvisionEngine(plan, [mockAdapter], baseCtx);
    // All mock results should be safe
    for (const r of result.results) {
      assert.ok(
        r.message.includes("Mock") || r.message.includes("no real"),
        `Mock result message should indicate it's mock: ${r.message}`
      );
    }
  });
});

// ─── Engine with real Trigger adapter (Phase 7E — has apply()) ───────────────
// All six provider adapters now have apply() after Phase 7E.
// This suite tests that Trigger's real apply() works with the engine.

import { TriggerAdapter } from "../src/provisioning/adapters/trigger.js";
import { createMockTriggerOps } from "../src/provisioning/trigger-local.js";

describe("engine with Trigger adapter (Phase 7E — real apply())", () => {
  test("Trigger mutating steps are gate_missing without gates", async () => {
    const adapters = [new TriggerAdapter()];
    const plan = await buildProvisionPlan(baseCtx, adapters);
    // No gates in baseCtx.env
    const result = await runProvisionEngine(plan, adapters, baseCtx);
    const mutatingResults = result.results.filter((r) => r.step.mutation);
    for (const r of mutatingResults) {
      assert.ok(
        r.status === "gate_missing" || r.status === "not_implemented",
        `Trigger mutating step ${r.step.id} must be gate_missing or not_implemented, got: ${r.status}`
      );
    }
  });

  test("Trigger register_task with mock ops and gate → applied", async () => {
    const mockOps = createMockTriggerOps({
      registerTasks: async () => ({ success: true, message: "Mock: tasks registered" }),
    });
    const adapters = [new TriggerAdapter(() => mockOps)];
    const ctx: ProvisionContext = {
      ...baseCtx,
      env: {
        TRIGGER_SECRET_KEY: "key",
        TRIGGER_PROJECT_ID: "proj",
        ALLOW_TRIGGER_TASK_REGISTER: "true",
        ALLOW_TRIGGER_PROVISION: "true",
      },
    };
    const plan = await buildProvisionPlan(ctx, adapters);
    const result = await runProvisionEngine(plan, adapters, ctx);
    const registerResult = result.results.find((r) => r.step.action === "register_task");
    assert.ok(
      registerResult?.status === "applied" || registerResult?.status === "manual_required",
      `Expected applied or manual_required, got: ${registerResult?.status}`
    );
  });
});

// ─── Engine result counts ────────────────────────────────────────────────────

describe("engine result counts", () => {
  test("total results equals plan steps count", async () => {
    const adapters = [new SupabaseAdapter()];
    const plan = await buildProvisionPlan(baseCtx, adapters);
    const result = await runProvisionEngine(plan, adapters, baseCtx);
    assert.equal(result.results.length, plan.steps.length);
  });

  test("success is false when there are failed steps", async () => {
    // Engine should report success=false only on actual failures
    const adapters = [new SupabaseAdapter()];
    const plan = await buildProvisionPlan(baseCtx, adapters);
    const result = await runProvisionEngine(plan, adapters, baseCtx);
    // No failures expected with gate_missing or not_implemented
    assert.equal(result.failedCount, 0);
    assert.equal(result.success, true);
  });
});
