/**
 * src/bootstrap/provider-scope-check.ts
 *
 * Check what capabilities each provider token/key supports.
 * Read-only checks only. Never makes API calls in this module.
 * Returns safe summaries — never token values.
 */

import type { ProviderScopeResult } from "./types.js";

const PROVIDER_REQUIRED_ENV: Record<string, string[]> = {
  github: ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO_NAME"],
  supabase: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  cloudflare: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_WORKER_NAME"],
  trigger: ["TRIGGER_SECRET_KEY", "TRIGGER_PROJECT_ID"],
  telegram: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_URL"],
  openai: ["OPENAI_API_KEY"],
};

const PROVIDER_CAPABILITIES: Record<string, string[]> = {
  github: ["create_repo", "set_remote", "initial_push"],
  supabase: ["apply_migrations", "verify_tables"],
  cloudflare: ["deploy_worker", "verify_health"],
  trigger: ["verify_project", "verify_task"],
  telegram: ["register_webhook", "verify_webhook", "verify_bot"],
  openai: ["verify_model"],
};

const PROVIDER_LIMITATIONS: Record<string, string[]> = {
  github: ["no auto-delete repos", "initial push only if repo is empty"],
  supabase: ["no auto-create project (manual)", "no direct SQL execution without CLI"],
  cloudflare: ["no auto-secret-upload (manual wrangler secret put)"],
  trigger: ["no auto-deploy (use npx trigger.dev@latest deploy)"],
  telegram: ["no bot creation (use BotFather)"],
  openai: ["no key creation (use OpenAI dashboard)"],
};

export function checkProviderScope(
  provider: string,
  env: Record<string, string | undefined>
): ProviderScopeResult {
  const required = PROVIDER_REQUIRED_ENV[provider] ?? [];
  const missingEnv = required.filter((k) => !env[k]);
  const configured = missingEnv.length === 0;

  return {
    provider,
    configured,
    missingEnv,
    capabilities: PROVIDER_CAPABILITIES[provider] ?? [],
    limitations: PROVIDER_LIMITATIONS[provider] ?? [],
    safeSummary: configured
      ? `${provider}: configured (${(PROVIDER_CAPABILITIES[provider] ?? []).join(", ")})`
      : `${provider}: missing ${missingEnv.join(", ")}`,
  };
}

export function checkAllProviderScopes(
  env: Record<string, string | undefined>
): ProviderScopeResult[] {
  return Object.keys(PROVIDER_REQUIRED_ENV).map((provider) =>
    checkProviderScope(provider, env)
  );
}
