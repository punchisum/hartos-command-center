/**
 * src/provisioning/adapters/cloudflare.ts
 *
 * Cloudflare provider adapter — Phase 7B real implementation.
 *
 * plan():    Returns set_secret, deploy_worker, verify_health steps.
 * verify():  Checks env vars. Calls /health if CLOUDFLARE_WORKER_URL is set.
 * apply():   Deploys Worker or returns manual instructions for secrets.
 * rollback(): Returns manual rollback instructions (no auto-delete in Phase 7B).
 *
 * Security rules:
 *   - CLOUDFLARE_API_TOKEN is NEVER printed, logged, or included in messages.
 *   - Authorization headers are NEVER logged.
 *   - All CLI output is sanitized before inclusion in messages.
 *   - Wrangler reads API token from env — this adapter never passes it explicitly.
 *   - Secret values are NEVER read, logged, or passed through this code.
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
  type CloudflareOps,
  realCloudflareOps,
} from "../cloudflare-local.js";

// Required env to consider Cloudflare "configured"
const REQUIRED_ENV = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_WORKER_NAME",
];

// Secrets that should be uploaded to Cloudflare Worker via wrangler secret put
const WORKER_SECRETS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "OPENAI_API_KEY",
  "TRIGGER_SECRET_KEY",
];

function safe(msg: string): string {
  return msg
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
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

export class CloudflareAdapter implements ProviderAdapter {
  readonly provider = "cloudflare" as const;
  private readonly cloudflareOps: CloudflareOps;
  private readonly fetchImpl: typeof fetch;

  constructor(
    cloudflareOps: CloudflareOps = realCloudflareOps,
    fetchImpl: typeof fetch = fetch
  ) {
    this.cloudflareOps = cloudflareOps;
    this.fetchImpl = fetchImpl;
  }

  async plan(context: ProvisionContext): Promise<ProvisionStep[]> {
    const env = context.environment;
    const isProd = env === "production";

    return [
      {
        id: `cloudflare:set_secret:${env}`,
        provider: "cloudflare",
        action: "set_secret",
        environment: context.environment,
        mutation: true,
        requiredGate: "ALLOW_CLOUDFLARE_SECRET_UPLOAD",
        productionGateRequired: isProd,
        description: "Upload secrets to Cloudflare Worker via wrangler",
        safeSummary:
          "Generates wrangler secret put commands for required secrets. " +
          "Secrets are never read or logged by this tool.",
        rollback: {
          description:
            "Delete secrets via: wrangler secret delete <NAME> --env " + env,
          notes: "Deleting secrets requires re-deploy to take effect.",
        },
        status: "planned",
      },
      {
        id: `cloudflare:deploy_worker:${env}`,
        provider: "cloudflare",
        action: "deploy_worker",
        environment: context.environment,
        mutation: true,
        requiredGate: "ALLOW_CLOUDFLARE_DEPLOY",
        productionGateRequired: isProd,
        description: `Deploy Cloudflare Worker (${env})`,
        safeSummary:
          "Runs: wrangler deploy --env " +
          env +
          ". Wrangler reads CLOUDFLARE_API_TOKEN from env automatically.",
        rollback: {
          description:
            "Rollback via Cloudflare dashboard or: wrangler rollback --env " + env,
          command: `wrangler rollback --env ${env}`,
          notes:
            "wrangler rollback availability depends on your Cloudflare plan.",
        },
        status: "planned",
      },
      {
        id: `cloudflare:verify_health:${env}`,
        provider: "cloudflare",
        action: "verify_health",
        environment: context.environment,
        mutation: false,
        description: `Verify Cloudflare Worker /health (${env})`,
        safeSummary:
          "Read-only: GET {CLOUDFLARE_WORKER_URL}/health. Checks deployment is live.",
        status: "planned",
      },
    ];
  }

  async verify(context: ProvisionContext): Promise<ProviderVerificationResult> {
    const missingEnv = REQUIRED_ENV.filter((k) => !context.env[k]);
    const workerUrl = context.env["CLOUDFLARE_WORKER_URL"];

    if (missingEnv.length > 0) {
      return {
        provider: "cloudflare",
        status: "missing_env",
        missingEnv: [...missingEnv, ...(workerUrl ? [] : ["CLOUDFLARE_WORKER_URL"])],
        supportedActions: ["verify_health"],
        unsupportedActions: ["set_secret", "deploy_worker"],
        nextAction: `Set ${missingEnv.join(", ")} to configure Cloudflare`,
        safeSummary: `Cloudflare not configured — missing: ${missingEnv.join(", ")}`,
      };
    }

    // All required env vars present — try health check if URL available
    const workerName = context.env["CLOUDFLARE_WORKER_NAME"] ?? "unknown";

    if (!workerUrl) {
      // CLOUDFLARE_WORKER_URL is optional pre-deploy; don't list it as missing.
      return {
        provider: "cloudflare",
        status: "configured",
        missingEnv: [],
        supportedActions: ["set_secret", "deploy_worker"],
        unsupportedActions: ["verify_health"],
        nextAction:
          "Set CLOUDFLARE_WORKER_URL after deploy to enable health checks",
        safeSummary: `Cloudflare configured. Worker: ${workerName}. Deploy URL not yet set.`,
      };
    }

    // Health check (read-only, always safe when URL is configured)
    const healthResult = await this.checkHealth(workerUrl);
    if (healthResult.ok) {
      return {
        provider: "cloudflare",
        status: "configured",
        missingEnv: [],
        supportedActions: ["set_secret", "deploy_worker", "verify_health"],
        unsupportedActions: [],
        nextAction: "Cloudflare Worker is live and healthy",
        safeSummary: `Cloudflare configured. Worker: ${workerName}. Health: ok`,
      };
    }

    return {
      provider: "cloudflare",
      status: "error",
      missingEnv: [],
      supportedActions: ["set_secret", "deploy_worker"],
      unsupportedActions: ["verify_health"],
      nextAction: `Health check failed (${healthResult.status}). Deploy Worker first.`,
      safeSummary: `Cloudflare configured but health check failed: HTTP ${healthResult.status}`,
    };
  }

  async apply(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    switch (step.action) {
      case "set_secret":
        return this.applySetSecret(step, context);
      case "deploy_worker":
        return this.applyDeployWorker(step, context);
      case "verify_health":
        return this.applyVerifyHealth(step, context);
      default:
        return result(
          step,
          "not_implemented",
          `Cloudflare action ${step.action} not implemented in Phase 7B`
        );
    }
  }

  async rollback(
    step: RollbackStep,
    _context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    // Phase 7B: manual instructions only — no auto-deletion of Workers or secrets.
    return {
      step: {
        id: "cloudflare:rollback",
        provider: "cloudflare",
        action: "deploy_worker",
        environment: "local",
        mutation: false,
        description: step.description,
        safeSummary: "Manual rollback required",
        status: "skipped",
      },
      status: "skipped",
      message: `Rollback instruction: ${step.description} (manual — no auto-deletion in Phase 7B)`,
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async checkHealth(
    url: string
  ): Promise<{ ok: boolean; status: number }> {
    try {
      const res = await this.fetchImpl(
        `${url.replace(/\/$/, "")}/health`,
        { method: "GET" }
      );
      return { ok: res.ok, status: res.status };
    } catch {
      return { ok: false, status: 0 };
    }
  }

  private async applySetSecret(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    // Option A: return manual_required with clear instructions.
    // We never read or pass actual secret values.
    const workerName =
      context.env["CLOUDFLARE_WORKER_NAME"] ?? "{{CLOUDFLARE_WORKER_NAME}}";
    const wranglerEnv =
      context.env["CLOUDFLARE_ENVIRONMENT"] ??
      (context.environment === "production" ? "production" : "staging");

    const cmds = WORKER_SECRETS.map(
      (s) => `  wrangler secret put ${s} --env ${wranglerEnv}`
    ).join("\n");

    return {
      step: { ...step, status: "manual_required" },
      status: "manual_required",
      message:
        `Secret upload requires manual action. ` +
        `Run these commands (values read from your terminal, never logged):\n${cmds}`,
      timestamp: new Date().toISOString(),
    };
  }

  private async applyDeployWorker(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    // Secondary gate check (also enforced by engine, but verify explicitly)
    if (context.env["ALLOW_CLOUDFLARE_DEPLOY"] !== "true") {
      return result(
        step,
        "gate_missing",
        "Deploy requires ALLOW_CLOUDFLARE_DEPLOY=true"
      );
    }

    const wranglerEnv =
      context.env["CLOUDFLARE_ENVIRONMENT"] ??
      (context.environment === "production" ? "production" : "staging");

    const deployResult = await this.cloudflareOps.deployWorker(wranglerEnv);

    if (deployResult.success) {
      return result(step, "applied", `Worker deployed to ${wranglerEnv}`);
    }

    return result(
      step,
      "failed",
      `Deploy failed: ${safe(deployResult.message)}`
    );
  }

  private async applyVerifyHealth(
    step: ProvisionStep,
    context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    const workerUrl = context.env["CLOUDFLARE_WORKER_URL"];
    if (!workerUrl) {
      return result(
        step,
        "skipped",
        "CLOUDFLARE_WORKER_URL not set — health check skipped"
      );
    }

    const health = await this.checkHealth(workerUrl);
    if (health.ok) {
      return result(step, "verified", `Health check passed: HTTP ${health.status}`);
    }

    return result(
      step,
      "failed",
      `Health check failed: HTTP ${health.status}`
    );
  }
}
