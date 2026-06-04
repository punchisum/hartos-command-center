/**
 * src/bootstrap/secret-destinations.ts
 *
 * Maps secret env var names to where they must be configured.
 * Generates exact CLI commands — never includes actual secret values.
 *
 * Usage: show users exactly what wrangler/CLI commands to run.
 */

import type { SecretDestination } from "./types.js";

const WRANGLER_ENV = "staging"; // can be parameterized

/** Known secrets and where they need to go */
export const SECRET_DESTINATIONS: SecretDestination[] = [
  {
    envVarName: "SUPABASE_URL",
    description: "Supabase project URL (not a secret, but needed as Worker var)",
    destinations: ["Cloudflare Worker vars (wrangler.toml)"],
    commands: [
      `# Add to wrangler.toml under [env.${WRANGLER_ENV}.vars]:`,
      `# SUPABASE_URL = "https://your-project.supabase.co"`,
    ],
    docs: "See wrangler.toml.example for configuration",
  },
  {
    envVarName: "SUPABASE_SERVICE_ROLE_KEY",
    description: "Supabase service role key — high privilege, keep secret",
    destinations: ["Cloudflare Worker secret"],
    commands: [
      `wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env ${WRANGLER_ENV}`,
    ],
    docs: "Never commit this key. Set via wrangler secret put.",
  },
  {
    envVarName: "TELEGRAM_BOT_TOKEN",
    description: "Telegram bot token from BotFather",
    destinations: ["Cloudflare Worker secret"],
    commands: [
      `wrangler secret put TELEGRAM_BOT_TOKEN --env ${WRANGLER_ENV}`,
    ],
    docs: "Get from BotFather (@BotFather on Telegram). Never commit.",
  },
  {
    envVarName: "TELEGRAM_WEBHOOK_SECRET",
    description: "Webhook validation secret (optional but recommended)",
    destinations: ["Cloudflare Worker secret"],
    commands: [
      `wrangler secret put TELEGRAM_WEBHOOK_SECRET --env ${WRANGLER_ENV}`,
    ],
    docs: "Generate a secure random string. Required for webhook validation.",
  },
  {
    envVarName: "OPENAI_API_KEY",
    description: "OpenAI API key for LLM calls",
    destinations: ["Cloudflare Worker secret"],
    commands: [
      `wrangler secret put OPENAI_API_KEY --env ${WRANGLER_ENV}`,
    ],
    docs: "Get from platform.openai.com. Never commit.",
  },
  {
    envVarName: "TRIGGER_SECRET_KEY",
    description: "Trigger.dev secret key for task enqueue",
    destinations: ["Cloudflare Worker secret", ".env.local for local dev"],
    commands: [
      `wrangler secret put TRIGGER_SECRET_KEY --env ${WRANGLER_ENV}`,
    ],
    docs: "Get from Trigger.dev dashboard. Never commit.",
  },
  {
    envVarName: "CLOUDFLARE_API_TOKEN",
    description: "Cloudflare API token for wrangler deploy",
    destinations: ["CI/CD environment variable", "Local .env.staging.local"],
    commands: [
      `# For CI: add as GitHub Actions secret CLOUDFLARE_API_TOKEN`,
      `# For local: add to .env.staging.local (gitignored)`,
    ],
    docs: "Create at dash.cloudflare.com/profile/api-tokens",
  },
  {
    envVarName: "GITHUB_TOKEN",
    description: "GitHub personal access token or fine-grained token",
    destinations: ["Local .env.staging.local", "CI/CD environment"],
    commands: [
      `# For CI: add as GitHub Actions secret GITHUB_TOKEN`,
      `# For local: add to .env.local (gitignored)`,
    ],
    docs: "Create at github.com/settings/tokens. Needs repo scope.",
  },
];

/** Get destination info for a specific secret */
export function getSecretDestination(envVarName: string): SecretDestination | undefined {
  return SECRET_DESTINATIONS.find((d) => d.envVarName === envVarName);
}

/** Get all secrets that are missing from env */
export function getMissingSecrets(
  env: Record<string, string | undefined>
): SecretDestination[] {
  return SECRET_DESTINATIONS.filter((d) => !env[d.envVarName]);
}

/** Format secret destinations as a readable guide */
export function formatSecretDestinations(
  secrets: SecretDestination[],
  agentName: string
): string {
  const lines = [
    `# Secret Destinations: ${agentName}`,
    ``,
    `Configure these secrets in the correct locations.`,
    `Never commit secret values to git.`,
    ``,
  ];

  for (const secret of secrets) {
    lines.push(`## ${secret.envVarName}`);
    lines.push(secret.description);
    lines.push(`Destinations: ${secret.destinations.join(", ")}`);
    if (secret.commands.length > 0) {
      lines.push(`Commands:`);
      for (const cmd of secret.commands) {
        lines.push(`  ${cmd}`);
      }
    }
    lines.push(`Docs: ${secret.docs}`);
    lines.push(``);
  }

  return lines.join("\n") + "\n";
}
