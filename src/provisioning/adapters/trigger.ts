/**
 * src/provisioning/adapters/trigger.ts
 *
 * Trigger.dev provider adapter — Phase 7E real implementation.
 *
 * plan():    Returns verify_project, register_task, verify_task steps.
 * verify():  Checks env; when ALLOW_TRIGGER_PROVISION=true, pings Trigger.dev API.
 * apply():   Verifies project/tasks; returns manual_required for real registration.
 * rollback(): Returns manual rollback instructions.
 *
 * Security rules:
 *   - TRIGGER_SECRET_KEY is NEVER printed, logged, or included in messages.
 *     never log context.env["TRIGGER_SECRET_KEY"] directly — pass only to ops factory.
 *   - Authorization headers are NEVER logged.
 *   - Task names and project IDs are safe to include.
 *
 * Phase 7E design note:
 *   Real task registration requires the Trigger.dev CLI or SDK.
 *   There is no simple REST API endpoint to register tasks remotely.
 *   register_task therefore returns manual_required with exact CLI instructions.
 *   verify_project and verify_task make real API calls when gates are open.
 */

import type {
  ProviderAdapter,
  ProvisionStep,
  ProvisionStepResult,
  ProvisionContext,
  ProviderVerificationResult,
  RollbackStep,
} from "../types.js";
import {
  type TriggerOps,
  defaultTriggerOpsFactory,
  parseExpectedTasks,
} from "../trigger-local.js";

const REQUIRED_ENV = ["TRIGGER_SECRET_KEY"];
const DEFAULT_API_URL = "https://api.trigger.dev";

function safe(msg: string): string {
  return msg
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "[REDACTED]")
    .replace(/Authorization:\s*\S+/gi, "Authorization: [REDACTED]")
    .slice(0, 200);
}

function result(
  step: ProvisionStep,
  status: ProvisionStepResult["status"],
  message: string
): ProvisionStepResult {
  return {
    step: { ...step, status },
    status,
    message: safe(message),
    timestamp: new Date().toISOString(),
  };
}

export class TriggerAdapter implements ProviderAdapter {
  readonly provider = "trigger" as const;
  private readonly triggerOpsFactory: (key: string, apiUrl: string) => TriggerOps;

  constructor(
    triggerOpsFactory: (key: string, apiUrl: string) => TriggerOps = defaultTriggerOpsFactory
  ) {
    this.triggerOpsFactory = triggerOpsFactory;
  }

  private getOps(context: ProvisionContext): TriggerOps | null {
    const key = context.env["TRIGGER_SECRET_KEY"];
    if (!key) return null;
    const apiUrl = context.env["TRIGGER_API_URL"] ?? DEFAULT_API_URL;
    return this.triggerOpsFactory(key, apiUrl);
  }

  async plan(context: ProvisionContext): Promise<ProvisionStep[]> {
    const env = context.environment;
    const isProd = env === "production";
    const expectedTasks = parseExpectedTasks(context.env["TRIGGER_EXPECTED_TASKS"]);

    return [
      {
        id: `trigger:verify_project:${env}`,
        provider: "trigger",
        action: "verify_project",
        environment: context.environment,
        mutation: false,
        description: "Verify Trigger.dev project is accessible",
        safeSummary:
          "Read-only: calls Trigger.dev API to confirm project ID and key are valid. " +
          "Never prints secret key.",
        status: "planned",
      },
      {
        id: `trigger:register_task:${env}`,
        provider: "trigger",
        action: "register_task",
        environment: context.environment,
        mutation: true,
        requiredGate: "ALLOW_TRIGGER_TASK_REGISTER",
        productionGateRequired: isProd,
        description:
          expectedTasks.length > 0
            ? `Register Trigger.dev tasks: ${expectedTasks.join(", ")}`
            : "Register Trigger.dev tasks (set TRIGGER_EXPECTED_TASKS to specify)",
        safeSummary:
          "Returns manual instructions for task registration via Trigger.dev CLI. " +
          "Run: npx trigger.dev@latest deploy",
        rollback: {
          description:
            "Disable tasks via the Trigger.dev dashboard or CLI: " +
            "npx trigger.dev@latest disable <task-slug>",
          notes: "No automatic task removal in Phase 7E.",
        },
        status: "planned",
      },
      {
        id: `trigger:verify_task:${env}`,
        provider: "trigger",
        action: "verify_task",
        environment: context.environment,
        mutation: false,
        description:
          expectedTasks.length > 0
            ? `Verify Trigger.dev tasks exist: ${expectedTasks.join(", ")}`
            : "Verify Trigger.dev tasks (no expected tasks configured)",
        safeSummary:
          "Read-only: lists registered tasks and compares against TRIGGER_EXPECTED_TASKS.",
        status: "planned",
      },
    ];
  }

  async verify(context: ProvisionContext): Promise<ProviderVerificationResult> {
    const missingRequired = REQUIRED_ENV.filter((k) => !context.env[k]);

    if (missingRequired.length > 0) {
      return {
        provider: "trigger",
        status: "missing_env",
        missingEnv: [...missingRequired, "TRIGGER_PROJECT_ID"],
        supportedActions: ["verify_project", "register_task", "verify_task"],
        unsupportedActions: [],
        nextAction: `Set ${missingRequired.join(", ")} to configure Trigger.dev`,
        safeSummary: `Trigger.dev not configured — missing: ${missingRequired.join(", ")}`,
      };
    }

    const projectId = context.env["TRIGGER_PROJECT_ID"];
    if (!projectId) {
      return {
        provider: "trigger",
        status: "degraded",
        missingEnv: ["TRIGGER_PROJECT_ID"],
        supportedActions: ["register_task", "verify_task"],
        unsupportedActions: ["verify_project"],
        nextAction: "Set TRIGGER_PROJECT_ID to enable project verification",
        safeSummary: "Trigger.dev key present but TRIGGER_PROJECT_ID not set.",
      };
    }

    // If gate is open, verify via Trigger.dev API
    if (context.env["ALLOW_TRIGGER_PROVISION"] === "true") {
      const ops = this.getOps(context);
      if (!ops) return this.configuredNoCheck(projectId);

      const verifyResult = await ops.verifyProject(projectId);
      if (!verifyResult.success) {
        return {
          provider: "trigger",
          status: "error",
          missingEnv: [],
          supportedActions: [],
          unsupportedActions: ["register_task"],
          nextAction: "Check TRIGGER_SECRET_KEY and TRIGGER_PROJECT_ID",
          safeSummary: `Trigger.dev verification failed: ${verifyResult.message}`,
        };
      }

      // Check expected tasks
      const expectedTasks = parseExpectedTasks(context.env["TRIGGER_EXPECTED_TASKS"]);
      if (expectedTasks.length > 0) {
        const taskResult = await ops.listTasks(projectId);
        const registeredSlugs = (taskResult.data?.["taskSlugs"] as string[] | undefined) ?? [];
        const missingTasks = expectedTasks.filter((t) => !registeredSlugs.includes(t));

        if (missingTasks.length > 0) {
          return {
            provider: "trigger",
            status: "degraded",
            missingEnv: [],
            supportedActions: ["verify_project", "verify_task"],
            unsupportedActions: [],
            nextAction: "Deploy missing tasks: npx trigger.dev@latest deploy",
            safeSummary:
              `Trigger.dev project accessible. Missing tasks: ${missingTasks.join(", ")}.`,
          };
        }
      }

      return {
        provider: "trigger",
        status: "configured",
        missingEnv: [],
        supportedActions: ["verify_project", "register_task", "verify_task"],
        unsupportedActions: [],
        nextAction: "Trigger.dev project and tasks verified",
        safeSummary: `Trigger.dev project "${projectId}" accessible`,
      };
    }

    return this.configuredNoCheck(projectId);
  }

  async apply(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    switch (step.action) {
      case "verify_project":
        return this.applyVerifyProject(step, context);
      case "register_task":
        return this.applyRegisterTask(step, context);
      case "verify_task":
        return this.applyVerifyTask(step, context);
      default:
        return result(
          step,
          "not_implemented",
          `Trigger action ${step.action} not implemented in Phase 7E`
        );
    }
  }

  async rollback(
    step: RollbackStep,
    _context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    return {
      step: {
        id: "trigger:rollback",
        provider: "trigger",
        action: "register_task",
        environment: "local",
        mutation: false,
        description: step.description,
        safeSummary: "Manual rollback required",
        status: "skipped",
      },
      status: "skipped",
      message: `Rollback: ${step.description} (manual — no auto-removal in Phase 7E)`,
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private configuredNoCheck(projectId: string): ProviderVerificationResult {
    return {
      provider: "trigger",
      status: "configured",
      missingEnv: [],
      supportedActions: ["verify_project", "register_task", "verify_task"],
      unsupportedActions: [],
      nextAction:
        "Set ALLOW_TRIGGER_PROVISION=true to verify project via Trigger.dev API",
      safeSummary:
        `Trigger.dev configured (key + project "${projectId}" set). ` +
        `Set ALLOW_TRIGGER_PROVISION=true to verify via API.`,
    };
  }

  private async applyVerifyProject(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    const projectId = context.env["TRIGGER_PROJECT_ID"];
    if (!projectId) return result(step, "failed", "Missing TRIGGER_PROJECT_ID");
    const ops = this.getOps(context);
    if (!ops) return result(step, "failed", "Missing TRIGGER_SECRET_KEY");
    const r = await ops.verifyProject(projectId);
    return r.success
      ? result(step, "verified", r.message)
      : result(step, "failed", r.message);
  }

  private async applyRegisterTask(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    const gate =
      context.env["ALLOW_TRIGGER_TASK_REGISTER"] === "true" ||
      context.env["ALLOW_TRIGGER_DEPLOY"] === "true";
    if (!gate) {
      return result(
        step,
        "gate_missing",
        "Task registration requires ALLOW_TRIGGER_TASK_REGISTER=true or ALLOW_TRIGGER_DEPLOY=true"
      );
    }

    const projectId = context.env["TRIGGER_PROJECT_ID"];
    if (!projectId) return result(step, "failed", "Missing TRIGGER_PROJECT_ID");
    const ops = this.getOps(context);
    if (!ops) return result(step, "failed", "Missing TRIGGER_SECRET_KEY");

    const r = await ops.registerTasks(projectId);
    if (r.success) {
      return result(step, "applied", `Trigger.dev tasks registered for project ${projectId}`);
    }
    if (r.manual) {
      return {
        step: { ...step, status: "manual_required" },
        status: "manual_required",
        message:
          "Trigger.dev task registration requires the CLI. " +
          "Run: npx trigger.dev@latest deploy",
        timestamp: new Date().toISOString(),
      };
    }
    return result(step, "failed", `Task registration failed: ${r.message}`);
  }

  private async applyVerifyTask(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    const projectId = context.env["TRIGGER_PROJECT_ID"];
    if (!projectId) return result(step, "failed", "Missing TRIGGER_PROJECT_ID");
    const ops = this.getOps(context);
    if (!ops) return result(step, "failed", "Missing TRIGGER_SECRET_KEY");

    const expectedTasks = parseExpectedTasks(context.env["TRIGGER_EXPECTED_TASKS"]);
    if (expectedTasks.length === 0) {
      return result(
        step,
        "skipped",
        "No expected tasks configured. Set TRIGGER_EXPECTED_TASKS to verify."
      );
    }

    const r = await ops.listTasks(projectId);
    if (!r.success) return result(step, "failed", `Task list failed: ${r.message}`);

    const registeredSlugs = (r.data?.["taskSlugs"] as string[] | undefined) ?? [];
    const missingTasks = expectedTasks.filter((t) => !registeredSlugs.includes(t));

    if (missingTasks.length === 0) {
      return result(
        step,
        "verified",
        `All expected tasks registered: ${expectedTasks.join(", ")}`
      );
    }
    return result(
      step,
      "degraded",
      `Missing tasks: ${missingTasks.join(", ")}. Run: npx trigger.dev@latest deploy`
    );
  }
}
