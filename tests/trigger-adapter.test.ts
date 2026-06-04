/**
 * tests/trigger-adapter.test.ts
 *
 * Tests for the Phase 7E real Trigger.dev adapter.
 * All API calls are mocked via injected TriggerOps factory.
 * No real Trigger.dev API calls are performed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TriggerAdapter } from "../src/provisioning/adapters/trigger.js";
import {
  type TriggerOps,
  createMockTriggerOps,
  parseExpectedTasks,
} from "../src/provisioning/trigger-local.js";
import type { ProvisionContext, ProvisionStep } from "../src/provisioning/types.js";

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeCtx(
  env: Record<string, string> = {},
  environment: "local" | "staging" | "production" = "staging"
): ProvisionContext {
  return { agentName: "test-agent", environment, env };
}

function makeAdapter(opsOverrides: Partial<TriggerOps> = {}): TriggerAdapter {
  const ops = createMockTriggerOps(opsOverrides);
  return new TriggerAdapter(() => ops);
}

const baseEnv = {
  TRIGGER_SECRET_KEY: "test-secret-key",
  TRIGGER_PROJECT_ID: "test-project-id",
  TRIGGER_API_URL: "https://api.trigger.dev",
  TRIGGER_EXPECTED_TASKS: "example-command,scheduled-job",
  ALLOW_TRIGGER_PROVISION: "true",
  ALLOW_TRIGGER_TASK_REGISTER: "true",
  ALLOW_AUTO_PROVISION: "true",
  CONFIRM_STAGING_PROVISION: "true",
};

const registerStep: ProvisionStep = {
  id: "trigger:register_task:staging",
  provider: "trigger",
  action: "register_task",
  environment: "staging",
  mutation: true,
  requiredGate: "ALLOW_TRIGGER_TASK_REGISTER",
  description: "Register tasks",
  safeSummary: "Registers tasks",
  status: "planned",
};

const verifyProjectStep: ProvisionStep = {
  id: "trigger:verify_project:staging",
  provider: "trigger",
  action: "verify_project",
  environment: "staging",
  mutation: false,
  description: "Verify project",
  safeSummary: "Verifies project",
  status: "planned",
};

const verifyTaskStep: ProvisionStep = {
  id: "trigger:verify_task:staging",
  provider: "trigger",
  action: "verify_task",
  environment: "staging",
  mutation: false,
  description: "Verify tasks",
  safeSummary: "Verifies tasks",
  status: "planned",
};

// ─── Missing env ─────────────────────────────────────────────────────────────

describe("Trigger adapter — missing env", () => {
  test("missing TRIGGER_SECRET_KEY → missing_env", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx({ TRIGGER_PROJECT_ID: "proj" });
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "missing_env");
    assert.ok(vr.missingEnv.includes("TRIGGER_SECRET_KEY"));
  });

  test("missing TRIGGER_PROJECT_ID → degraded (key present)", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx({ TRIGGER_SECRET_KEY: "key" });
    const vr = await adapter.verify(ctx);
    // degraded or missing_env
    assert.ok(vr.status === "degraded" || vr.status === "missing_env");
    assert.ok(vr.missingEnv.includes("TRIGGER_PROJECT_ID"));
  });

  test("all env present → configured", async () => {
    const adapter = makeAdapter({
      verifyProject: async () => ({ success: true, message: "Project accessible" }),
      listTasks: async () => ({
        success: true,
        message: "2 tasks",
        data: { taskSlugs: ["example-command", "scheduled-job"] },
      }),
    });
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "configured");
  });
});

// ─── parseExpectedTasks ───────────────────────────────────────────────────────

describe("parseExpectedTasks", () => {
  test("parses comma-separated task names", () => {
    const tasks = parseExpectedTasks("example-command,scheduled-job");
    assert.deepEqual(tasks, ["example-command", "scheduled-job"]);
  });

  test("handles spaces around task names", () => {
    const tasks = parseExpectedTasks("task-a , task-b , task-c");
    assert.deepEqual(tasks, ["task-a", "task-b", "task-c"]);
  });

  test("returns empty array for undefined", () => {
    assert.deepEqual(parseExpectedTasks(undefined), []);
  });

  test("returns empty array for empty string", () => {
    assert.deepEqual(parseExpectedTasks(""), []);
  });
});

// ─── verify — project check ───────────────────────────────────────────────────

describe("Trigger adapter — verify project check", () => {
  test("project verify success → configured", async () => {
    const adapter = makeAdapter({
      verifyProject: async () => ({ success: true, message: "Project accessible" }),
      listTasks: async () => ({
        success: true,
        message: "Tasks found",
        data: { taskSlugs: ["example-command", "scheduled-job"] },
      }),
    });
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "configured");
  });

  test("project verify failure → error", async () => {
    const adapter = makeAdapter({
      verifyProject: async () => ({ success: false, message: "Auth failed: HTTP 401" }),
    });
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "error");
    assert.ok(
      !vr.safeSummary.includes("test-secret-key"),
      "Summary must not contain secret key"
    );
  });

  test("no API call without ALLOW_TRIGGER_PROVISION gate", async () => {
    let apiCalled = false;
    const adapter = makeAdapter({
      verifyProject: async () => {
        apiCalled = true;
        return { success: true, message: "Project OK" };
      },
    });
    const env = { TRIGGER_SECRET_KEY: "key", TRIGGER_PROJECT_ID: "proj" };
    const ctx = makeCtx(env);
    await adapter.verify(ctx);
    assert.equal(apiCalled, false, "API must not be called without ALLOW_TRIGGER_PROVISION");
  });
});

// ─── verify — task check ──────────────────────────────────────────────────────

describe("Trigger adapter — verify task check", () => {
  test("all expected tasks present → configured", async () => {
    const adapter = makeAdapter({
      verifyProject: async () => ({ success: true, message: "OK" }),
      listTasks: async () => ({
        success: true,
        message: "2 tasks",
        data: { taskSlugs: ["example-command", "scheduled-job"] },
      }),
    });
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "configured");
  });

  test("missing expected tasks → degraded", async () => {
    const adapter = makeAdapter({
      verifyProject: async () => ({ success: true, message: "OK" }),
      listTasks: async () => ({
        success: true,
        message: "1 task",
        data: { taskSlugs: ["example-command"] }, // missing: scheduled-job
      }),
    });
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "degraded");
    assert.ok(vr.safeSummary.includes("scheduled-job") || vr.nextAction.includes("deploy"));
  });
});

// ─── register_task ────────────────────────────────────────────────────────────

describe("Trigger adapter — register_task", () => {
  test("register_task requires ALLOW_TRIGGER_TASK_REGISTER gate", async () => {
    const adapter = makeAdapter();
    const env = { ...baseEnv, ALLOW_TRIGGER_TASK_REGISTER: "false" };
    delete (env as Record<string, string>)["ALLOW_TRIGGER_DEPLOY"];
    const ctx = makeCtx(env);
    const r = await adapter.apply(registerStep, ctx);
    assert.ok(r.status === "gate_missing" || r.status === "failed");
    assert.ok(
      r.message.includes("ALLOW_TRIGGER_TASK_REGISTER") ||
        r.message.includes("ALLOW_TRIGGER_DEPLOY")
    );
  });

  test("mock register_task success → applied", async () => {
    const adapter = makeAdapter({
      registerTasks: async () => ({ success: true, message: "Tasks registered" }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(registerStep, ctx);
    assert.equal(r.status, "applied");
  });

  test("real register_task → manual_required with CLI instructions", async () => {
    const ops = createMockTriggerOps({
      registerTasks: async () => ({
        success: false,
        manual: true,
        message: "Use Trigger.dev CLI",
      }),
    });
    const adapter = new TriggerAdapter(() => ops);
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(registerStep, ctx);
    assert.equal(r.status, "manual_required");
    assert.ok(r.message.includes("CLI") || r.message.includes("trigger.dev"));
  });

  test("register_task with ALLOW_TRIGGER_DEPLOY also opens gate", async () => {
    const env: Record<string, string> = { ...baseEnv };
    delete env["ALLOW_TRIGGER_TASK_REGISTER"];
    env["ALLOW_TRIGGER_DEPLOY"] = "true";
    const adapter = makeAdapter({
      registerTasks: async () => ({ success: true, message: "Tasks registered" }),
    });
    const ctx = makeCtx(env);
    const r = await adapter.apply(registerStep, ctx);
    assert.equal(r.status, "applied");
  });

  test("production register_task has productionGateRequired=true", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(baseEnv, "production");
    const steps = await adapter.plan(ctx);
    const step = steps.find((s) => s.action === "register_task");
    assert.ok(step?.productionGateRequired === true);
  });
});

// ─── verify_project apply ─────────────────────────────────────────────────────

describe("Trigger adapter — verify_project apply", () => {
  test("success → verified", async () => {
    const adapter = makeAdapter({
      verifyProject: async () => ({ success: true, message: "Project accessible" }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(verifyProjectStep, ctx);
    assert.equal(r.status, "verified");
  });

  test("failure → failed with safe message", async () => {
    const adapter = makeAdapter({
      verifyProject: async () => ({ success: false, message: "API error: HTTP 404" }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(verifyProjectStep, ctx);
    assert.equal(r.status, "failed");
    assert.ok(!r.message.includes("test-secret-key"), "Must not include secret key");
  });

  test("missing project ID → failed", async () => {
    const adapter = makeAdapter();
    const env = { ...baseEnv };
    delete (env as Record<string, string>)["TRIGGER_PROJECT_ID"];
    const ctx = makeCtx(env);
    const r = await adapter.apply(verifyProjectStep, ctx);
    assert.equal(r.status, "failed");
    assert.ok(r.message.includes("TRIGGER_PROJECT_ID"));
  });
});

// ─── verify_task apply ────────────────────────────────────────────────────────

describe("Trigger adapter — verify_task apply", () => {
  test("all tasks present → verified", async () => {
    const adapter = makeAdapter({
      listTasks: async () => ({
        success: true,
        message: "2 tasks",
        data: { taskSlugs: ["example-command", "scheduled-job"] },
      }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(verifyTaskStep, ctx);
    assert.equal(r.status, "verified");
  });

  test("missing tasks → degraded", async () => {
    const adapter = makeAdapter({
      listTasks: async () => ({
        success: true,
        message: "1 task",
        data: { taskSlugs: ["example-command"] },
      }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(verifyTaskStep, ctx);
    assert.equal(r.status, "degraded");
    assert.ok(r.message.includes("scheduled-job"));
  });

  test("no expected tasks → skipped", async () => {
    const adapter = makeAdapter();
    const env = { ...baseEnv };
    delete (env as Record<string, string>)["TRIGGER_EXPECTED_TASKS"];
    const ctx = makeCtx(env);
    const r = await adapter.apply(verifyTaskStep, ctx);
    assert.equal(r.status, "skipped");
    assert.ok(r.message.includes("TRIGGER_EXPECTED_TASKS"));
  });
});

// ─── Secrets never in output ──────────────────────────────────────────────────

describe("Trigger adapter — secrets never in output", () => {
  test("verify() safeSummary never includes secret key", async () => {
    const adapter = makeAdapter({
      verifyProject: async () => ({ success: true, message: "OK" }),
    });
    const ctx = makeCtx(baseEnv);
    const vr = await adapter.verify(ctx);
    assert.ok(!vr.safeSummary.includes("test-secret-key"), "safeSummary must not contain key");
    assert.ok(!vr.nextAction.includes("test-secret-key"), "nextAction must not contain key");
  });

  test("apply verify_project failure never includes secret key", async () => {
    // The adapter should never inject the secret key into error messages.
    // Mock returns a safe error (no key); verify adapter doesn't add it.
    const adapter = makeAdapter({
      verifyProject: async () => ({ success: false, message: "API error: HTTP 401" }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(verifyProjectStep, ctx);
    assert.equal(r.status, "failed");
    // The adapter must not include the TRIGGER_SECRET_KEY value from context.env
    assert.ok(!r.message.includes("test-secret-key"), "Error must not contain secret key");
  });

  test("register_task message never includes secret key", async () => {
    const adapter = makeAdapter({
      registerTasks: async () => ({ success: true, message: "Registered" }),
    });
    const ctx = makeCtx(baseEnv);
    const r = await adapter.apply(registerStep, ctx);
    assert.ok(!r.message.includes("test-secret-key"), "Message must not contain secret key");
  });
});

// ─── plan() ───────────────────────────────────────────────────────────────────

describe("Trigger adapter — plan()", () => {
  test("plan returns verify_project, register_task, verify_task", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    const actions = steps.map((s) => s.action);
    assert.ok(actions.includes("verify_project"));
    assert.ok(actions.includes("register_task"));
    assert.ok(actions.includes("verify_task"));
  });

  test("verify_project and verify_task are read-only", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    const vp = steps.find((s) => s.action === "verify_project");
    const vt = steps.find((s) => s.action === "verify_task");
    assert.equal(vp?.mutation, false);
    assert.equal(vt?.mutation, false);
  });

  test("register_task requires ALLOW_TRIGGER_TASK_REGISTER gate", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    const step = steps.find((s) => s.action === "register_task");
    assert.equal(step?.requiredGate, "ALLOW_TRIGGER_TASK_REGISTER");
  });

  test("register_task step description includes expected task names when set", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx({ ...baseEnv, TRIGGER_EXPECTED_TASKS: "my-task,other-task" });
    const steps = await adapter.plan(ctx);
    const step = steps.find((s) => s.action === "register_task");
    assert.ok(step?.description.includes("my-task") || step?.description.includes("other-task"));
  });

  test("register_task has rollback instructions", async () => {
    const adapter = makeAdapter();
    const ctx = makeCtx(baseEnv);
    const steps = await adapter.plan(ctx);
    const step = steps.find((s) => s.action === "register_task");
    assert.ok(step?.rollback, "register_task must have rollback instructions");
  });
});
