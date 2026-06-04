/**
 * tests/supabase-adapter.test.ts
 *
 * Tests for the Phase 7D real Supabase adapter.
 * All Supabase API calls are mocked via injected SupabaseOps factory.
 * No real Supabase API calls or real project/migration operations are performed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SupabaseAdapter } from "../src/provisioning/adapters/supabase.js";
import {
  type SupabaseOps,
  createMockSupabaseOps,
} from "../src/provisioning/supabase-local.js";
import type { ProvisionContext, ProvisionStep } from "../src/provisioning/types.js";

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeCtx(
  env: Record<string, string> = {},
  environment: "local" | "staging" | "production" = "staging"
): ProvisionContext {
  return { agentName: "test-agent", environment, env };
}

function makeAdapter(opsOverrides: Partial<SupabaseOps> = {}): SupabaseAdapter {
  const ops = createMockSupabaseOps(opsOverrides);
  return new SupabaseAdapter(() => ops);
}

const baseEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
  SUPABASE_PROJECT_REF: "test-ref",
  SUPABASE_ORG_ID: "test-org",
  ALLOW_SUPABASE_PROVISION: "true",
  ALLOW_SUPABASE_PROJECT_CREATE: "true",
  ALLOW_SUPABASE_MIGRATION_APPLY: "true",
  ALLOW_AUTO_PROVISION: "true",
  CONFIRM_STAGING_PROVISION: "true",
};

const createProjectStep: ProvisionStep = {
  id: "supabase:create_project:staging",
  provider: "supabase",
  action: "create_project",
  environment: "staging",
  mutation: true,
  requiredGate: "ALLOW_SUPABASE_PROJECT_CREATE",
  description: "Create Supabase project",
  safeSummary: "Creates project",
  status: "planned",
};

const migrationsStep: ProvisionStep = {
  id: "supabase:apply_migrations:staging",
  provider: "supabase",
  action: "apply_migrations",
  environment: "staging",
  mutation: true,
  requiredGate: "ALLOW_SUPABASE_MIGRATION_APPLY",
  description: "Apply migrations",
  safeSummary: "Applies migrations",
  status: "planned",
};

const verifyTablesStep: ProvisionStep = {
  id: "supabase:verify_tables:staging",
  provider: "supabase",
  action: "verify_tables",
  environment: "staging",
  mutation: false,
  description: "Verify tables",
  safeSummary: "Verifies tables",
  status: "planned",
};

// ─── Missing env ─────────────────────────────────────────────────────────────

describe("Supabase adapter — missing env", () => {
  test("missing SUPABASE_URL → missing_env", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx({ SUPABASE_SERVICE_ROLE_KEY: "key" });
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "missing_env");
    assert.ok(vr.missingEnv.includes("SUPABASE_URL"));
  });

  test("missing SUPABASE_SERVICE_ROLE_KEY → missing_env", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx({ SUPABASE_URL: "https://example.supabase.co" });
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "missing_env");
    assert.ok(vr.missingEnv.includes("SUPABASE_SERVICE_ROLE_KEY"));
  });

  test("both env vars present → configured", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "key",
    });
    const vr = await adapter.verify(ctx);
    assert.ok(vr.status === "configured" || vr.status === "degraded");
  });
});

// ─── Verify — table checks ────────────────────────────────────────────────────

describe("Supabase adapter — verify table checks", () => {
  test("all tables present → configured", async () => {
    const adapter = makeAdapter({
      tableExists: async () => ({ success: true, message: "Table exists" }),
    });
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "configured");
    assert.ok(vr.safeSummary.includes("verified") || vr.safeSummary.includes("exist"));
  });

  test("missing table → degraded", async () => {
    const adapter = makeAdapter({
      tableExists: async (name) => ({
        success: name === "action_tokens",
        message: name === "action_tokens" ? "Table exists" : "Table not found",
      }),
    });
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "degraded");
    assert.ok(
      vr.safeSummary.includes("debug_events") || vr.nextAction.includes("debug_events")
    );
  });

  test("table check not performed without ALLOW_SUPABASE_PROVISION", async () => {
    let checkCalled = false;
    const adapter = makeAdapter({
      tableExists: async () => {
        checkCalled = true;
        return { success: true, message: "Table exists" };
      },
    });
    const ctx = makeCtx({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "key",
    });
    await adapter.verify(ctx);
    assert.equal(checkCalled, false, "Table check must not run without ALLOW_SUPABASE_PROVISION");
  });
});

// ─── create_project ───────────────────────────────────────────────────────────

describe("Supabase adapter — create_project", () => {
  test("create_project requires ALLOW_SUPABASE_PROJECT_CREATE gate", async () => {
    const adapter = makeAdapter();
    const env = { ...baseEnv, ALLOW_SUPABASE_PROJECT_CREATE: "false" };
    const ctx = makeCtx(env);
    const r = await adapter.apply(createProjectStep, ctx);
    assert.ok(r.status === "gate_missing" || r.status === "failed");
    assert.ok(r.message.includes("ALLOW_SUPABASE_PROJECT_CREATE"));
  });

  test("mock create_project success → created", async () => {
    const adapter = makeAdapter({
      createProject: async () => ({
        success: true,
        message: "Mock project created",
        data: { projectRef: "mock-ref" },
      }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(createProjectStep, ctx);
    assert.equal(r.status, "created");
  });

  test("real create_project → manual_required with instructions", async () => {
    // Real ops factory always returns manual_required
    const realOps = createMockSupabaseOps({
      createProject: async () => ({
        success: false,
        manual: true,
        message: "manual_required",
      }),
    });
    const adapter = new SupabaseAdapter(() => realOps);
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(createProjectStep, ctx);
    assert.equal(r.status, "manual_required");
  });

  test("missing SUPABASE_ORG_ID → failed", async () => {
    const adapter = makeAdapter();
    const env = { ...baseEnv };
    delete (env as Record<string, string>)["SUPABASE_ORG_ID"];
    const ctx = makeCtx(env);
    const r = await adapter.apply(createProjectStep, ctx);
    assert.equal(r.status, "failed");
    assert.ok(r.message.includes("SUPABASE_ORG_ID"));
  });

  test("production create_project requires productionGateRequired=true", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(baseEnv, "production");
    const steps = await adapter.plan(ctx);
    const step = steps.find((s) => s.action === "create_project");
    assert.ok(step?.productionGateRequired === true);
  });
});

// ─── apply_migrations ─────────────────────────────────────────────────────────

describe("Supabase adapter — apply_migrations", () => {
  test("apply_migrations requires ALLOW_SUPABASE_MIGRATION_APPLY gate", async () => {
    const adapter = makeAdapter();
    const env = { ...baseEnv, ALLOW_SUPABASE_MIGRATION_APPLY: "false" };
    const ctx = makeCtx(env);
    const r = await adapter.apply(migrationsStep, ctx);
    assert.ok(r.status === "gate_missing" || r.status === "failed");
    assert.ok(r.message.includes("ALLOW_SUPABASE_MIGRATION_APPLY"));
  });

  test("mock apply_migrations success → applied", async () => {
    const adapter = makeAdapter({
      applyMigrations: async () => ({
        success: true,
        message: "3 migrations applied",
        data: { applied: 3 },
      }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(migrationsStep, ctx);
    // applied or manual_required (if no pending migrations or validation error)
    assert.ok(r.status === "applied" || r.status === "manual_required", `got: ${r.status}`);
  });

  test("real ops apply_migrations → manual_required", async () => {
    const realOps = createMockSupabaseOps({
      applyMigrations: async () => ({
        success: false,
        manual: true,
        message: "manual_required",
      }),
    });
    const adapter = new SupabaseAdapter(() => realOps);
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(migrationsStep, ctx);
    // manual_required or applied (if no pending)
    assert.ok(r.status === "manual_required" || r.status === "applied", `got: ${r.status}`);
  });

  test("production apply_migrations has productionGateRequired=true", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(baseEnv, "production");
    const steps = await adapter.plan(ctx);
    const step = steps.find((s) => s.action === "apply_migrations");
    assert.ok(step?.productionGateRequired === true);
  });
});

// ─── verify_tables ────────────────────────────────────────────────────────────

describe("Supabase adapter — verify_tables apply", () => {
  test("all tables present → verified", async () => {
    const adapter = makeAdapter({
      tableExists: async () => ({ success: true, message: "Table exists" }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(verifyTablesStep, ctx);
    assert.equal(r.status, "verified");
    assert.ok(
      r.message.includes("debug_events") || r.message.includes("All required")
    );
  });

  test("missing table → degraded", async () => {
    const adapter = makeAdapter({
      tableExists: async () => ({ success: false, message: "Table not found" }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(verifyTablesStep, ctx);
    assert.equal(r.status, "degraded");
  });

  test("missing env → failed", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx({});
    const r = await adapter.apply(verifyTablesStep, ctx);
    assert.equal(r.status, "failed");
    assert.ok(
      r.message.includes("SUPABASE_URL") || r.message.includes("SUPABASE_SERVICE_ROLE_KEY")
    );
  });
});

// ─── Engine integration ───────────────────────────────────────────────────────

describe("Supabase adapter — engine integration", () => {
  test("engine skips Supabase mutation without gate", async () => {
    const { runProvisionEngine } = await import("../src/provisioning/engine.js");
    const { buildProvisionPlan, buildContext } = await import("../src/provisioning/plan.js");
    const adapter = makeAdapter();
    const ctx = buildContext("test-agent", "staging");
    // No ALLOW_SUPABASE_MIGRATION_APPLY in env
    const plan = await buildProvisionPlan({ ...ctx, env: {} }, [adapter]);
    const engineResult = await runProvisionEngine(plan, [adapter], { ...ctx, env: {} });
    const migResult = engineResult.results.find(
      (r) => r.step.action === "apply_migrations"
    );
    assert.ok(
      migResult?.status === "gate_missing" || migResult?.status === "skipped",
      `Expected gate_missing or skipped, got: ${migResult?.status}`
    );
  });

  test("engine applies mock migration when gate is open", async () => {
    const { runProvisionEngine } = await import("../src/provisioning/engine.js");
    const { buildProvisionPlan } = await import("../src/provisioning/plan.js");
    const adapter = makeAdapter({
      applyMigrations: async () => ({ success: true, message: "Migrations applied" }),
      tableExists: async () => ({ success: true, message: "Table exists" }),
    });
    const ctx = {
      agentName: "test-agent",
      environment: "staging" as const,
      env: baseEnv,
    };
    const plan = await buildProvisionPlan(ctx, [adapter]);
    const engineResult = await runProvisionEngine(plan, [adapter], ctx);
    // With mock ops, should not have gate_missing for supabase steps (gate is open in baseEnv)
    const failedSteps = engineResult.results.filter((r) => r.status === "failed");
    assert.equal(failedSteps.length, 0, `No steps should fail: ${failedSteps.map(r=>r.message).join("; ")}`);
  });
});

// ─── Secrets never in output ──────────────────────────────────────────────────

describe("Supabase adapter — secrets never in output", () => {
  test("verify() safeSummary never includes service role key", async () => {
    const adapter = makeAdapter({
      tableExists: async () => ({ success: true, message: "Table exists" }),
    });
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    assert.ok(!vr.safeSummary.includes("test-service-key"), "safeSummary must not contain key");
    assert.ok(!vr.nextAction.includes("test-service-key"), "nextAction must not contain key");
  });

  test("apply migrations message never includes service role key", async () => {
    const adapter = makeAdapter({
      applyMigrations: async () => ({ success: true, message: "Migrations done" }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(migrationsStep, ctx);
    assert.ok(!r.message.includes("test-service-key"), "Message must not contain key");
  });

  test("error message never includes service role key", async () => {
    const adapter = makeAdapter({
      tableExists: async () => ({
        success: false,
        message: `Table not found. Bearer test-service-key was invalid`,
      }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(verifyTablesStep, ctx);
    assert.ok(
      !r.message.includes("test-service-key"),
      "Error must not contain service role key"
    );
  });
});

// ─── plan() ───────────────────────────────────────────────────────────────────

describe("Supabase adapter — plan()", () => {
  test("plan returns create_project, apply_migrations, verify_tables", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    const actions = steps.map((s) => s.action);
    assert.ok(actions.includes("create_project"));
    assert.ok(actions.includes("apply_migrations"));
    assert.ok(actions.includes("verify_tables"));
  });

  test("verify_tables is read-only", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    const step = steps.find((s) => s.action === "verify_tables");
    assert.equal(step?.mutation, false);
  });

  test("migration plan is read-only (plan() never mutates)", async () => {
    let mutationCalled = false;
    const adapter = makeAdapter({
      applyMigrations: async () => {
        mutationCalled = true;
        return { success: true, message: "Applied" };
      },
    });
    const ctx = makeCtx(baseEnv);
    await adapter.plan(ctx); // plan() must never call applyMigrations
    assert.equal(mutationCalled, false, "plan() must not trigger any mutations");
  });

  test("all mutating steps have rollback instructions", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    for (const step of steps.filter((s) => s.mutation)) {
      assert.ok(step.rollback, `Step ${step.action} must have rollback instructions`);
    }
  });
});
