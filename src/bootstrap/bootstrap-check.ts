/**
 * src/bootstrap/bootstrap-check.ts
 *
 * Bootstrap readiness check — what's configured vs what's missing.
 * No mutations. Safe to run anytime.
 */

import type { BootstrapStep, BootstrapPlan, BootstrapStatus } from "./types.js";
import { checkAllProviderScopes } from "./provider-scope-check.js";
import { getMissingSecrets } from "./secret-destinations.js";

const BOOTSTRAP_GATES = [
  "ALLOW_BOOTSTRAP_PROVISION",
  "CONFIRM_BOOTSTRAP_PROVISION",
];

const PROVIDER_BOOTSTRAP_GATES: Record<string, string> = {
  supabase_project: "ALLOW_SUPABASE_PROJECT_CREATE",
  supabase_migrations: "ALLOW_SUPABASE_MIGRATION_APPLY",
  cloudflare_secrets: "ALLOW_CLOUDFLARE_SECRET_UPLOAD",
  trigger_deploy: "ALLOW_TRIGGER_DEPLOY",
  github_repo: "ALLOW_GITHUB_PROVISION",
  launch_notifications: "ALLOW_LAUNCH_NOTIFICATIONS",
};

function step(
  id: string,
  provider: string,
  action: string,
  status: BootstrapStatus,
  message: string,
  nextAction: string,
  opts: { gate?: string; manualRequired?: boolean; commands?: string[] } = {}
): BootstrapStep {
  return {
    id,
    provider,
    action,
    status,
    message,
    manualRequired: opts.manualRequired ?? status === "manual_required",
    requiredGate: opts.gate,
    nextAction,
    manualCommands: opts.commands,
  };
}

export async function checkBootstrap(
  env: Record<string, string | undefined>
): Promise<BootstrapPlan> {
  const timestamp = new Date().toISOString();
  const agentName = "test-agent";
  const steps: BootstrapStep[] = [];
  const missingGates: string[] = [];
  const missingEnv: string[] = [];

  // 1. Global bootstrap gates
  for (const gate of BOOTSTRAP_GATES) {
    if (env[gate] !== "true") missingGates.push(gate);
  }

  // 2. Provider scope checks
  const scopes = checkAllProviderScopes(env);
  for (const scope of scopes) {
    const status: BootstrapStatus = scope.configured ? "ready" : "missing_env";
    for (const envVar of scope.missingEnv) {
      if (!missingEnv.includes(envVar)) missingEnv.push(envVar);
    }
    steps.push(step(
      `${scope.provider}:scope`,
      scope.provider,
      "scope_check",
      status,
      scope.safeSummary,
      scope.configured
        ? `${scope.provider} credentials configured`
        : `Set ${scope.missingEnv.join(", ")} to configure ${scope.provider}`
    ));
  }

  // 3. Specific bootstrap steps (manual_required by default)
  steps.push(step(
    "supabase:project",
    "supabase",
    "create_project",
    "manual_required",
    "Supabase project creation requires dashboard or Supabase CLI",
    "Create project at https://supabase.com/dashboard/new",
    {
      gate: PROVIDER_BOOTSTRAP_GATES["supabase_project"],
      commands: [
        "# Option 1: Supabase dashboard",
        "# Option 2: supabase projects create <name>",
        "# Then: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
      ],
    }
  ));

  steps.push(step(
    "supabase:migrations",
    "supabase",
    "apply_migrations",
    env["ALLOW_SUPABASE_MIGRATION_APPLY"] === "true" ? "ready" : "gate_missing",
    env["ALLOW_SUPABASE_MIGRATION_APPLY"] === "true"
      ? "Migration apply gate open"
      : "Migration apply requires ALLOW_SUPABASE_MIGRATION_APPLY=true",
    "ALLOW_SUPABASE_MIGRATION_APPLY=true npm run migrations:apply",
    { gate: "ALLOW_SUPABASE_MIGRATION_APPLY" }
  ));

  steps.push(step(
    "cloudflare:secrets",
    "cloudflare",
    "upload_secrets",
    "manual_required",
    "Cloudflare secret upload requires manual wrangler commands",
    "Run: wrangler secret put <NAME> --env staging",
    {
      gate: PROVIDER_BOOTSTRAP_GATES["cloudflare_secrets"],
      commands: [
        "wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging",
        "wrangler secret put TELEGRAM_BOT_TOKEN --env staging",
        "wrangler secret put OPENAI_API_KEY --env staging",
        "wrangler secret put TRIGGER_SECRET_KEY --env staging",
      ],
    }
  ));

  steps.push(step(
    "trigger:deploy",
    "trigger",
    "register_tasks",
    "manual_required",
    "Trigger.dev task registration requires Trigger CLI",
    "Run: npx trigger.dev@latest deploy",
    {
      gate: PROVIDER_BOOTSTRAP_GATES["trigger_deploy"],
      commands: ["npx trigger.dev@latest deploy"],
    }
  ));

  steps.push(step(
    "cloudflare:deploy",
    "cloudflare",
    "deploy_worker",
    env["ALLOW_CLOUDFLARE_DEPLOY"] === "true" ? "ready" : "gate_missing",
    env["ALLOW_CLOUDFLARE_DEPLOY"] === "true"
      ? "Cloudflare deploy gate open"
      : "Deploy requires ALLOW_CLOUDFLARE_DEPLOY=true",
    "ALLOW_CLOUDFLARE_DEPLOY=true npm run deploy:staging",
    { gate: "ALLOW_CLOUDFLARE_DEPLOY" }
  ));

  steps.push(step(
    "telegram:webhook",
    "telegram",
    "register_webhook",
    env["ALLOW_TELEGRAM_WEBHOOK_REGISTER"] === "true" ? "ready" : "gate_missing",
    env["ALLOW_TELEGRAM_WEBHOOK_REGISTER"] === "true"
      ? "Webhook register gate open"
      : "Requires ALLOW_TELEGRAM_WEBHOOK_REGISTER=true",
    "ALLOW_TELEGRAM_WEBHOOK_REGISTER=true npm run telegram:register-webhook",
    { gate: "ALLOW_TELEGRAM_WEBHOOK_REGISTER" }
  ));

  // 4. Missing secret destinations
  const missingSecrets = getMissingSecrets(env);
  if (missingSecrets.length > 0) {
    for (const s of missingSecrets) {
      if (!missingEnv.includes(s.envVarName)) missingEnv.push(s.envVarName);
    }
  }

  const readyCount = steps.filter((s) => s.status === "ready").length;
  const manualCount = steps.filter((s) => s.manualRequired).length;
  const missingEnvCount = steps.filter((s) => s.status === "missing_env").length;

  return {
    agentName,
    timestamp,
    steps,
    missingGates,
    missingEnv: [...new Set(missingEnv)],
    readyCount,
    manualCount,
    missingEnvCount,
    summary:
      `Bootstrap: ${readyCount} ready, ${manualCount} manual, ${missingEnvCount} missing env. ` +
      (missingGates.length > 0 ? `${missingGates.length} gates missing.` : "Gates ok."),
  };
}
