/**
 * src/launch/readiness.ts
 *
 * Pre-launch readiness checks for the staging launch orchestration.
 * No mutations. No gates required. Safe to run anytime.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import type { ReadinessItem, LaunchReadinessResult } from "./types.js";
import { checkProviderStatus } from "../runtime/env.js";

const STAGING_GATES = [
  "ALLOW_AUTO_PROVISION",
  "CONFIRM_STAGING_PROVISION",
];

const PROVIDER_GATES: Record<string, string> = {
  github: "ALLOW_GITHUB_PROVISION",
  openai: "ALLOW_OPENAI_VERIFY",
  supabase: "ALLOW_SUPABASE_PROVISION",
  cloudflare: "ALLOW_CLOUDFLARE_DEPLOY",
  telegram: "ALLOW_TELEGRAM_WEBHOOK_REGISTER",
  trigger: "ALLOW_TRIGGER_TASK_REGISTER",
};

function item(name: string, ok: boolean, note: string): ReadinessItem {
  return { name, ok, note };
}

export async function checkLaunchReadiness(
  env: Record<string, string | undefined>,
  root: string
): Promise<LaunchReadinessResult> {
  const checks: ReadinessItem[] = [];
  const missingGates: string[] = [];
  const warnings: string[] = [];

  // 1. Global staging gates (informational — not blocking for readiness check)
  for (const gate of STAGING_GATES) {
    const open = env[gate] === "true";
    checks.push(
      item(
        `gate:${gate}`,
        open,
        open ? "open" : `set ${gate}=true to enable launch mutations`
      )
    );
    if (!open) missingGates.push(gate);
  }

  // 2. Provider gates (informational)
  for (const [provider, gate] of Object.entries(PROVIDER_GATES)) {
    const open = env[gate] === "true";
    checks.push(
      item(
        `gate:${provider}`,
        open,
        open ? "open" : `set ${gate}=true to provision ${provider}`
      )
    );
    if (!open) missingGates.push(gate);
  }

  // 3. Provider env vars (informational)
  const providerStatuses = checkProviderStatus(env as Record<string, string>);
  for (const ps of providerStatuses) {
    const missing = ps.checks.filter((c) => !c.present).map((c) => c.name);
    checks.push(
      item(
        `provider:${ps.provider}`,
        ps.configured,
        ps.configured ? "configured" : `missing: ${missing.join(", ")}`
      )
    );
    if (!ps.configured) {
      warnings.push(`${ps.provider}: missing ${missing.join(", ")}`);
    }
  }

  // 4. Configuration files
  checks.push(
    item(
      "config:wrangler_example",
      existsSync(path.join(root, "wrangler.toml.example")),
      "wrangler.toml.example"
    )
  );
  checks.push(
    item(
      "config:env_staging",
      existsSync(path.join(root, ".env.staging.example")),
      ".env.staging.example"
    )
  );

  // 5. Migration dir
  const migrationsExist = existsSync(path.join(root, "supabase", "migrations"));
  checks.push(
    item(
      "migrations:dir",
      migrationsExist,
      migrationsExist ? "supabase/migrations/ found" : "supabase/migrations/ not found"
    )
  );

  // 6. Agent.yaml
  const agentYamlExists = existsSync(path.join(root, "agent.yaml"));
  checks.push(
    item(
      "config:agent_yaml",
      agentYamlExists,
      agentYamlExists ? "agent.yaml found" : "agent.yaml missing"
    )
  );

  // Overall readiness: exclude gate checks (they're always informational)
  const nonGateChecks = checks.filter((c) => !c.name.startsWith("gate:") && !c.name.startsWith("provider:"));
  const ready = nonGateChecks.every((c) => c.ok);

  return { ready, checks, missingGates, warnings };
}
