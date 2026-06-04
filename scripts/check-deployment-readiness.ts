/**
 * scripts/check-deployment-readiness.ts
 *
 * Pre-deployment readiness check. No side effects.
 * Prints a structured readiness report for staging or production.
 *
 * Usage:
 *   npm run deployment:check
 *   APP_ENV=staging npm run deployment:check
 */

import path from "node:path";
import { getEnv, optionalEnv, checkProviderStatus } from "../src/runtime/env.js";
import { planMigrations } from "../src/supabase/migration-runner.js";
import { existsSync } from "node:fs";

const env = getEnv();
const environment = optionalEnv(env, "APP_ENV") ?? "local";
const agentName = "test-agent";
const root = process.cwd();

export interface ReadinessCheck {
  name: string;
  ok: boolean;
  note: string;
}

export interface ReadinessReport {
  agentName: string;
  environment: string;
  timestamp: string;
  checks: ReadinessCheck[];
  ready: boolean;
}

function check(name: string, ok: boolean, note: string): ReadinessCheck {
  return { name, ok, note };
}

// ─── Run checks ───────────────────────────────────────────────────────────────

const checks: ReadinessCheck[] = [];

// 1. Provider env vars
const providerStatuses = checkProviderStatus(env);
for (const ps of providerStatuses) {
  const missing = ps.checks.filter((c) => !c.present).map((c) => c.name);
  if (missing.length === 0) {
    checks.push(check(`provider:${ps.provider}`, true, "all env vars present"));
  } else {
    checks.push(
      check(`provider:${ps.provider}`, false, `missing: ${missing.join(", ")}`)
    );
  }
}

// 2. Deployment gates (informational — not required for readiness check itself)
const deployGate = env.ALLOW_CLOUDFLARE_DEPLOY === "true";
const migrationGate = env.ALLOW_SUPABASE_MIGRATION_APPLY === "true";
const webhookGate = env.ALLOW_TELEGRAM_WEBHOOK_REGISTER === "true";
const productionGate = env.CONFIRM_PRODUCTION_DEPLOY === "true";

checks.push(
  check(
    "gate:cloudflare_deploy",
    deployGate,
    deployGate ? "ALLOW_CLOUDFLARE_DEPLOY=true" : "set ALLOW_CLOUDFLARE_DEPLOY=true to deploy"
  )
);
checks.push(
  check(
    "gate:migration_apply",
    migrationGate,
    migrationGate
      ? "ALLOW_SUPABASE_MIGRATION_APPLY=true"
      : "set ALLOW_SUPABASE_MIGRATION_APPLY=true to apply"
  )
);
checks.push(
  check(
    "gate:telegram_webhook",
    webhookGate,
    webhookGate
      ? "ALLOW_TELEGRAM_WEBHOOK_REGISTER=true"
      : "set ALLOW_TELEGRAM_WEBHOOK_REGISTER=true to register"
  )
);

if (environment === "production") {
  checks.push(
    check(
      "gate:confirm_production",
      productionGate,
      productionGate
        ? "CONFIRM_PRODUCTION_DEPLOY=true"
        : "set CONFIRM_PRODUCTION_DEPLOY=true for production"
    )
  );
}

// 3. Migration plan
const migrationsDir = path.join(root, "supabase", "migrations");
const ledgerPath = path.join(root, ".migration-ledger.json");

if (existsSync(migrationsDir)) {
  const plan = await planMigrations(migrationsDir, ledgerPath, agentName, environment);
  if (plan.errors.length > 0) {
    checks.push(check("migrations:valid", false, `validation errors: ${plan.errors.join("; ")}`));
  } else {
    checks.push(
      check(
        "migrations:pending",
        plan.pending.length === 0,
        plan.pending.length === 0
          ? "no pending migrations"
          : `${plan.pending.length} pending: ${plan.pending.map((m) => m.filename).join(", ")}`
      )
    );
  }
} else {
  checks.push(check("migrations:dir", false, `supabase/migrations/ not found`));
}

// 4. wrangler.toml.example present
checks.push(
  check(
    "config:wrangler_example",
    existsSync(path.join(root, "wrangler.toml.example")),
    "wrangler.toml.example present"
  )
);

// 5. .env.staging.example / .env.production.example
const stagingEnvExample = existsSync(path.join(root, ".env.staging.example"));
const prodEnvExample = existsSync(path.join(root, ".env.production.example"));
checks.push(
  check("config:env_staging_example", stagingEnvExample, ".env.staging.example present")
);
checks.push(
  check("config:env_production_example", prodEnvExample, ".env.production.example present")
);

// 6. Staging smoke report exists (for production promotion)
if (environment === "production") {
  const reportsDir = path.join(root, "migration-reports");
  const hasReports = existsSync(reportsDir);
  checks.push(
    check(
      "staging:smoke_evidence",
      hasReports,
      hasReports ? "migration-reports/ directory found" : "run staging deployment first"
    )
  );
}

// ─── Report ───────────────────────────────────────────────────────────────────

const report: ReadinessReport = {
  agentName,
  environment,
  timestamp: new Date().toISOString(),
  checks,
  ready: checks
    .filter((c) => !c.name.startsWith("gate:"))
    .every((c) => c.ok),
};

console.log(`Deployment readiness: ${agentName} → ${environment}`);
console.log(`Timestamp: ${report.timestamp}`);
console.log("");

const maxName = Math.max(...checks.map((c) => c.name.length));
for (const c of checks) {
  const icon = c.ok ? "✓" : "✗";
  const pad = " ".repeat(maxName - c.name.length + 2);
  console.log(`  ${icon} ${c.name}${pad}${c.note}`);
}

console.log("");
console.log(`Overall: ${report.ready ? "READY" : "NOT READY"}`);

if (!report.ready) {
  console.log("");
  console.log("Fix the failing checks before deploying.");
  console.log("Gates (✗) are expected — set them only when you are ready to deploy.");
}

process.exit(0);
