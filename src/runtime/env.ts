import type { Env } from "../shared/types.js";

const SECRET_NAME_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD|SERVICE_ROLE)/i;
const SECRET_VALUE_PATTERN = /(sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]{32,})/g;

export type ProviderName = "supabase" | "telegram" | "trigger" | "cloudflare" | "openai";

export interface EnvCheck {
  name: string;
  present: boolean;
  secret: boolean;
}

export interface ProviderStatus {
  provider: ProviderName;
  configured: boolean;
  checks: EnvCheck[];
}

export function getEnv(source: NodeJS.ProcessEnv | Env = process.env): Env {
  return source as Env;
}

export function optionalEnv(env: Env, name: keyof Env): string | undefined {
  const value = env[name];
  return value && value.length > 0 ? value : undefined;
}

export function requireEnv(env: Env, name: keyof Env): string {
  const value = optionalEnv(env, name);
  if (!value) throw new Error(`Missing required env var: ${String(name)}`);
  return value;
}

export function redact(name: string, value: string | undefined): string {
  if (!value) return "missing";
  if (!SECRET_NAME_PATTERN.test(name)) return value.replace(SECRET_VALUE_PATTERN, "[REDACTED]");
  if (value.length <= 4) return "[REDACTED]";
  return `${value.slice(0, 2)}...[REDACTED]`;
}

export function checkEnvVars(env: Env, names: (keyof Env)[]): EnvCheck[] {
  return names.map((name) => ({
    name: String(name),
    present: Boolean(optionalEnv(env, name)),
    secret: SECRET_NAME_PATTERN.test(String(name)),
  }));
}

export function checkProviderStatus(env: Env = getEnv()): ProviderStatus[] {
  const providers: Array<{ provider: ProviderName; vars: (keyof Env)[] }> = [
    { provider: "supabase", vars: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] },
    { provider: "telegram", vars: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_URL", "TELEGRAM_WEBHOOK_SECRET"] },
    { provider: "trigger", vars: ["TRIGGER_SECRET_KEY"] },
    { provider: "cloudflare", vars: ["CLOUDFLARE_WORKER_URL"] },
    { provider: "openai", vars: ["OPENAI_API_KEY"] },
  ];

  return providers.map(({ provider, vars }) => {
    const checks = checkEnvVars(env, vars);
    return {
      provider,
      checks,
      configured: checks.every((check) => check.present),
    };
  });
}

export function printProviderStatus(statuses: ProviderStatus[]): void {
  for (const status of statuses) {
    console.log(`${status.provider}: ${status.configured ? "configured" : "not configured"}`);
    for (const check of status.checks) {
      console.log(`  ${check.name}: ${check.present ? "present" : "missing"}`);
    }
  }
}
