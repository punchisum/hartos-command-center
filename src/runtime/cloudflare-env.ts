/**
 * src/runtime/cloudflare-env.ts
 *
 * Server-side env handling for the hosted cockpit. Env values are NEVER exposed
 * to the frontend or to reports — only PRESENCE is ever reported. Secret-named
 * variables are flagged so callers can be doubly careful.
 */

import type { CloudflareCockpitEnv, EnvPresence } from "./cloudflare-cockpit-types.js";

const SECRET_NAME_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD|SERVICE_ROLE)/i;

/** The server-side env the hosted cockpit is aware of. Names only — no values. */
export const COCKPIT_ENV_VARS: string[] = [
  // Runtime self-reference (the cockpit's own URL). Deploy-target creds + deploy/provision gates
  // (CLOUDFLARE_API_TOKEN, *_ACCOUNT_ID, ALLOW_*_DEPLOY, …) are intentionally NOT listed here: they
  // are deploy-time secrets used from Hart's machine, never by the RUNNING Worker — listing them made
  // the Technical page falsely report "1 required missing" for a token the Worker doesn't need.
  "CLOUDFLARE_COCKPIT_URL",
  // Hosted access gate (Phase 16) — fail-closed auth
  "HARTOS_COCKPIT_ACCESS_TOKEN",
  "HARTOS_COCKPIT_REQUIRE_AUTH",
  "HARTOS_COCKPIT_DEV_AUTH_BYPASS",
  "APP_ENV",
  // LLM gateway (network gated) — Gemini primary, OpenAI fallback
  "HARTOS_LLM_PROVIDER",
  "HARTOS_LLM_MODEL",
  "HARTOS_GEMINI_MODEL",
  "HARTOS_LLM_ENABLE_NETWORK",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  // Read-only Supabase read models
  "HARTOS_OPS_SUPABASE_URL",
  "HARTOS_OPS_SUPABASE_READONLY_KEY",
  "HARTOS_FITNESS_SUPABASE_URL",
  "HARTOS_FITNESS_SUPABASE_READONLY_KEY",
  // Phase 16D — Fitness RPCs are scoped by (user_id, agent_id) uuids. These are
  // non-secret identifiers, not credentials, but are required for live Fitness
  // reads. Without them the Fitness read-model resolves to "missing".
  "HARTOS_FITNESS_USER_ID",
  "HARTOS_FITNESS_AGENT_ID",
  // Phase E — hosted "Ask HartOS → proposal" write path. The Worker holds ONLY a
  // capability token to invoke the gated Edge Function (NOT a DB/service-role
  // key); both are optional — absent ⇒ the Ask box stays advisory (no write).
  "HARTOS_ASK_WRITE_URL",
  "HARTOS_ASK_WRITE_TOKEN",
  // Sentinel heartbeat — optional alert sink (e.g. a Telegram/Slack webhook). Absent ⇒ alerts log only.
  "HARTOS_SENTINEL_ALERT_WEBHOOK",
];

export function isSecretName(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name);
}

/** Presence-only summary. Returns booleans + secret flags, NEVER values. */
export function summarizeEnvPresence(
  env: CloudflareCockpitEnv,
  names: string[] = COCKPIT_ENV_VARS
): EnvPresence[] {
  return names.map((name) => {
    const value = env[name];
    return {
      name,
      present: typeof value === "string" && value.trim().length > 0,
      secret: isSecretName(name),
    };
  });
}

/** True only when the value is a non-empty string. Never returns the value. */
export function envPresent(env: CloudflareCockpitEnv, name: string): boolean {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0;
}

/** Resolve the runtime mode without leaking anything. */
export function resolveLlmNetworkGate(env: CloudflareCockpitEnv): boolean {
  return env["HARTOS_LLM_ENABLE_NETWORK"] === "true";
}
