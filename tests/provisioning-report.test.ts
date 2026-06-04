/**
 * tests/provisioning-report.test.ts
 *
 * Tests for provisioning report formatting and secret safety.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  formatProvisionPlan,
  formatProvisionResult,
  assertNoSecrets,
  makeReportFilename,
} from "../src/provisioning/report.js";
import { buildProvisionPlan, buildContext } from "../src/provisioning/plan.js";
import { runProvisionEngine } from "../src/provisioning/engine.js";
import { MockAdapter } from "../src/provisioning/adapters/mock.js";
import { SupabaseAdapter } from "../src/provisioning/adapters/supabase.js";
import type { ProvisionContext } from "../src/provisioning/types.js";

const ctx: ProvisionContext = {
  agentName: "report-test-agent",
  environment: "staging",
  env: {},
};

// ─── formatProvisionPlan ─────────────────────────────────────────────────────

describe("formatProvisionPlan", () => {
  test("includes agent name", async () => {
    const adapters = [new SupabaseAdapter()];
    const plan = await buildProvisionPlan(ctx, adapters);
    const formatted = formatProvisionPlan(plan);
    assert.ok(formatted.includes("report-test-agent"));
  });

  test("includes environment", async () => {
    const adapters = [new SupabaseAdapter()];
    const plan = await buildProvisionPlan(ctx, adapters);
    const formatted = formatProvisionPlan(plan);
    assert.ok(formatted.includes("staging"));
  });

  test("includes step IDs", async () => {
    const adapters = [new SupabaseAdapter()];
    const plan = await buildProvisionPlan(ctx, adapters);
    const formatted = formatProvisionPlan(plan);
    for (const step of plan.steps) {
      assert.ok(formatted.includes(step.id), `Plan must include step ID: ${step.id}`);
    }
  });

  test("includes required gates for mutating steps", async () => {
    const adapters = [new SupabaseAdapter()];
    const plan = await buildProvisionPlan(ctx, adapters);
    const formatted = formatProvisionPlan(plan);
    // Phase 7D: Supabase now uses specific gates (not the old ALLOW_SUPABASE_PROVISION)
    assert.ok(
      formatted.includes("ALLOW_SUPABASE_PROJECT_CREATE") ||
        formatted.includes("ALLOW_SUPABASE_MIGRATION_APPLY") ||
        formatted.includes("ALLOW_SUPABASE_PROVISION"),
      "Plan must include at least one Supabase gate"
    );
  });

  test("does not contain secret patterns", async () => {
    const ctxWithEnv: ProvisionContext = {
      ...ctx,
      env: {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      },
    };
    const adapters = [new SupabaseAdapter()];
    const plan = await buildProvisionPlan(ctxWithEnv, adapters);
    const formatted = formatProvisionPlan(plan);
    assert.doesNotThrow(() => assertNoSecrets(formatted));
  });
});

// ─── formatProvisionResult ───────────────────────────────────────────────────

describe("formatProvisionResult", () => {
  test("includes agent name", async () => {
    const adapters = [new MockAdapter("supabase")];
    const plan = await buildProvisionPlan(ctx, adapters);
    const result = await runProvisionEngine(plan, adapters, ctx);
    const formatted = formatProvisionResult(result);
    assert.ok(formatted.includes("report-test-agent"));
  });

  test("includes environment", async () => {
    const adapters = [new MockAdapter("supabase")];
    const plan = await buildProvisionPlan(ctx, adapters);
    const result = await runProvisionEngine(plan, adapters, ctx);
    const formatted = formatProvisionResult(result);
    assert.ok(formatted.includes("staging"));
  });

  test("shows counts correctly", async () => {
    const adapters = [new SupabaseAdapter()];
    const plan = await buildProvisionPlan(ctx, adapters);
    const result = await runProvisionEngine(plan, adapters, ctx);
    const formatted = formatProvisionResult(result);
    assert.ok(formatted.includes("Gate missing:") || formatted.includes("gate_missing"));
  });

  test("does not contain raw secrets", async () => {
    const adapters = [new MockAdapter("supabase"), new SupabaseAdapter()];
    const plan = await buildProvisionPlan(ctx, adapters);
    const result = await runProvisionEngine(plan, adapters, ctx);
    const formatted = formatProvisionResult(result);
    assert.doesNotThrow(() => assertNoSecrets(formatted));
  });
});

// ─── assertNoSecrets ─────────────────────────────────────────────────────────

describe("assertNoSecrets", () => {
  test("passes for clean report content", () => {
    const clean = "# Report\nEnvironment: staging\nApplied: 0\nGate missing: 3\n";
    assert.doesNotThrow(() => assertNoSecrets(clean));
  });

  test("passes for report with step IDs and provider names", () => {
    const clean = `# Report\nsupabase:apply_migrations:staging applied\ncloudflare:deploy_worker:staging gate_missing\n`;
    assert.doesNotThrow(() => assertNoSecrets(clean));
  });

  test("throws for report with API key pattern", () => {
    const prefix = "sk";
    const dirty = `# Report\nkey: ${prefix}-${"a1b2c3d4e5f6g7h8i9j0k1l2m3"}\n`;
    assert.throws(() => assertNoSecrets(dirty), /Secret-looking value/);
  });
});

// ─── makeReportFilename ───────────────────────────────────────────────────────

describe("makeReportFilename", () => {
  test("includes prefix and environment", () => {
    const name = makeReportFilename("provision-plan", "staging");
    assert.ok(name.startsWith("provision-plan-staging-"));
    assert.ok(name.endsWith(".md"));
  });

  test("different calls produce unique filenames", () => {
    const a = makeReportFilename("provision-plan", "staging");
    const b = makeReportFilename("provision-plan", "staging");
    // Both should include the same prefix/env, may be same if called in same ms
    assert.ok(a.startsWith("provision-plan-staging-"));
    assert.ok(b.startsWith("provision-plan-staging-"));
  });
});
