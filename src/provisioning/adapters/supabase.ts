/**
 * src/provisioning/adapters/supabase.ts
 *
 * Supabase provider adapter — Phase 7D real implementation.
 *
 * plan():    Returns create_project, apply_migrations, verify_tables steps.
 * verify():  Checks env; when ALLOW_SUPABASE_PROVISION=true, verifies tables.
 * apply():   Creates project (manual_required), applies migrations (real/manual_required),
 *            verifies tables.
 * rollback(): Returns manual rollback instructions.
 *
 * Security rules:
 *   - SUPABASE_SERVICE_ROLE_KEY is NEVER printed, logged, or included in messages.
 *     It is used only as an Authorization header — never expose it in output.
 *   - SUPABASE_ACCESS_TOKEN is NEVER printed, logged, or included in messages.
 *   - SUPABASE_DB_PASSWORD is NEVER printed, logged, or included in messages.
 *   - Authorization headers are NEVER logged.
 *   - All messages use safe summaries (table names, HTTP status codes only).
 */

import path from "node:path";
import type {
  ProviderAdapter,
  ProvisionStep,
  ProvisionStepResult,
  ProvisionContext,
  ProviderVerificationResult,
  RollbackStep,
} from "../types.js";
import {
  type SupabaseOps,
  defaultSupabaseOpsFactory,
} from "../supabase-local.js";
import {
  planMigrations,
  validateMigrationFiles,
} from "../../supabase/migration-runner.js";

// Required for Supabase to be considered configured
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

// Core tables that must exist after migrations are applied
const REQUIRED_TABLES = ["debug_events", "action_tokens"];

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

export class SupabaseAdapter implements ProviderAdapter {
  readonly provider = "supabase" as const;
  private readonly supabaseOpsFactory: (url: string, key: string) => SupabaseOps;

  constructor(
    supabaseOpsFactory: (url: string, key: string) => SupabaseOps = defaultSupabaseOpsFactory
  ) {
    this.supabaseOpsFactory = supabaseOpsFactory;
  }

  private getOps(context: ProvisionContext): SupabaseOps | null {
    const url = context.env["SUPABASE_URL"];
    const key = context.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) return null;
    return this.supabaseOpsFactory(url, key);
  }

  async plan(context: ProvisionContext): Promise<ProvisionStep[]> {
    const env = context.environment;
    const isProd = env === "production";

    return [
      {
        id: `supabase:create_project:${env}`,
        provider: "supabase",
        action: "create_project",
        environment: context.environment,
        mutation: true,
        requiredGate: "ALLOW_SUPABASE_PROJECT_CREATE",
        productionGateRequired: isProd,
        description: `Create Supabase project for ${context.agentName} (${env})`,
        safeSummary:
          "Returns manual instructions for project creation via dashboard or CLI. " +
          "No automatic project creation in Phase 7D.",
        rollback: {
          description:
            "Delete the Supabase project via the Supabase dashboard. This is irreversible.",
          notes: "Confirm before deleting. All data will be lost.",
        },
        status: "planned",
      },
      {
        id: `supabase:apply_migrations:${env}`,
        provider: "supabase",
        action: "apply_migrations",
        environment: context.environment,
        mutation: true,
        requiredGate: "ALLOW_SUPABASE_MIGRATION_APPLY",
        productionGateRequired: isProd,
        description: `Apply database migrations (${env})`,
        safeSummary:
          "Plans and applies pending migrations. " +
          "Run: ALLOW_SUPABASE_MIGRATION_APPLY=true npm run migrations:apply",
        rollback: {
          description:
            "Write reverting migrations and apply via Supabase CLI or dashboard.",
          command: "npm run migrations:plan",
        },
        status: "planned",
      },
      {
        id: `supabase:verify_tables:${env}`,
        provider: "supabase",
        action: "verify_tables",
        environment: context.environment,
        mutation: false,
        description: `Verify required tables exist in Supabase (${env})`,
        safeSummary: `Read-only: checks that ${REQUIRED_TABLES.join(", ")} exist.`,
        status: "planned",
      },
    ];
  }

  async verify(context: ProvisionContext): Promise<ProviderVerificationResult> {
    const missingRequired = REQUIRED_ENV.filter((k) => !context.env[k]);

    if (missingRequired.length > 0) {
      return {
        provider: "supabase",
        status: "missing_env",
        missingEnv: missingRequired,
        supportedActions: ["create_project", "apply_migrations", "verify_tables"],
        unsupportedActions: [],
        nextAction: `Set ${missingRequired.join(", ")} to configure Supabase`,
        safeSummary: `Supabase not configured — missing: ${missingRequired.join(", ")}`,
      };
    }

    // If gate is open, verify table existence
    if (context.env["ALLOW_SUPABASE_PROVISION"] === "true") {
      const ops = this.getOps(context);
      if (!ops) {
        return this.configuredNoCheck();
      }

      const tableResults = await Promise.all(
        REQUIRED_TABLES.map((t) => ops.tableExists(t))
      );
      const missingTables = REQUIRED_TABLES.filter((_, i) => !tableResults[i]!.success);

      if (missingTables.length > 0) {
        return {
          provider: "supabase",
          status: "degraded",
          missingEnv: [],
          supportedActions: ["create_project", "apply_migrations", "verify_tables"],
          unsupportedActions: [],
          nextAction: `Apply migrations to create missing tables: ${missingTables.join(", ")}`,
          safeSummary:
            `Supabase reachable. Missing tables: ${missingTables.join(", ")}. ` +
            `Run migrations:apply.`,
        };
      }

      return {
        provider: "supabase",
        status: "configured",
        missingEnv: [],
        supportedActions: ["create_project", "apply_migrations", "verify_tables"],
        unsupportedActions: [],
        nextAction: "Supabase is fully configured and tables verified",
        safeSummary: `Supabase configured. Tables verified: ${REQUIRED_TABLES.join(", ")}`,
      };
    }

    return this.configuredNoCheck();
  }

  async apply(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    switch (step.action) {
      case "create_project":
        return this.applyCreateProject(step, context);
      case "apply_migrations":
        return this.applyMigrations(step, context);
      case "verify_tables":
        return this.applyVerifyTables(step, context);
      default:
        return result(
          step,
          "not_implemented",
          `Supabase action ${step.action} not implemented in Phase 7D`
        );
    }
  }

  async rollback(
    step: RollbackStep,
    _context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    return {
      step: {
        id: "supabase:rollback",
        provider: "supabase",
        action: "apply_migrations",
        environment: "local",
        mutation: false,
        description: step.description,
        safeSummary: "Manual rollback required",
        status: "skipped",
      },
      status: "skipped",
      message: `Rollback: ${step.description} (manual — no auto-deletion in Phase 7D)`,
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private configuredNoCheck(): ProviderVerificationResult {
    return {
      provider: "supabase",
      status: "configured",
      missingEnv: [],
      supportedActions: ["create_project", "apply_migrations", "verify_tables"],
      unsupportedActions: [],
      nextAction:
        "Set ALLOW_SUPABASE_PROVISION=true to verify table existence",
      safeSummary: "Supabase configured (env present). Table check requires ALLOW_SUPABASE_PROVISION=true.",
    };
  }

  private async applyCreateProject(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    if (context.env["ALLOW_SUPABASE_PROJECT_CREATE"] !== "true") {
      return result(
        step,
        "gate_missing",
        "Project creation requires ALLOW_SUPABASE_PROJECT_CREATE=true"
      );
    }

    const orgId = context.env["SUPABASE_ORG_ID"];
    const region = context.env["SUPABASE_REGION"] ?? "us-east-1";

    if (!orgId) {
      return result(step, "failed", "Missing SUPABASE_ORG_ID for project creation");
    }

    const ops = this.getOps(context);
    if (!ops) {
      return result(step, "failed", "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const r = await ops.createProject({
      name: context.agentName,
      orgId,
      region,
    });

    if (r.success) {
      return result(step, "created", `Supabase project created for ${context.agentName}`);
    }
    if (r.manual) {
      return {
        step: { ...step, status: "manual_required" },
        status: "manual_required",
        message: safe(r.message),
        timestamp: new Date().toISOString(),
      };
    }
    return result(step, "failed", `Project creation failed: ${r.message}`);
  }

  private async applyMigrations(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    if (context.env["ALLOW_SUPABASE_MIGRATION_APPLY"] !== "true") {
      return result(
        step,
        "gate_missing",
        "Migration apply requires ALLOW_SUPABASE_MIGRATION_APPLY=true"
      );
    }

    // Validate migration files first (fail fast before any mutation)
    const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
    const ledgerPath = path.join(process.cwd(), ".migration-ledger.json");
    const environment = context.environment;

    const plan = await planMigrations(migrationsDir, ledgerPath, context.agentName, environment);

    if (plan.errors.length > 0) {
      return result(
        step,
        "failed",
        `Migration validation failed: ${plan.errors.slice(0, 2).join("; ")}`
      );
    }

    if (plan.pending.length === 0) {
      return result(step, "applied", "No pending migrations — database is up to date");
    }

    const ops = this.getOps(context);
    if (!ops) {
      return result(step, "failed", "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const r = await ops.applyMigrations(migrationsDir, environment);

    if (r.success) {
      return result(
        step,
        "applied",
        `Migrations applied: ${plan.pending.length} pending migration(s)`
      );
    }
    if (r.manual) {
      return {
        step: { ...step, status: "manual_required" },
        status: "manual_required",
        message:
          `${plan.pending.length} migration(s) pending. ` +
          `Run: ALLOW_SUPABASE_MIGRATION_APPLY=true npm run migrations:apply`,
        timestamp: new Date().toISOString(),
      };
    }
    return result(step, "failed", `Migration apply failed: ${r.message}`);
  }

  private async applyVerifyTables(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    const ops = this.getOps(context);
    if (!ops) {
      return result(step, "failed", "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const tableResults = await Promise.all(
      REQUIRED_TABLES.map((t) => ops.tableExists(t))
    );
    const missingTables = REQUIRED_TABLES.filter((_, i) => !tableResults[i]!.success);

    if (missingTables.length === 0) {
      return result(
        step,
        "verified",
        `All required tables exist: ${REQUIRED_TABLES.join(", ")}`
      );
    }

    return result(
      step,
      "degraded",
      `Missing tables: ${missingTables.join(", ")}. Run migrations:apply.`
    );
  }
}
