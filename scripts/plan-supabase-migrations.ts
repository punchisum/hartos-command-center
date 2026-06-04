/**
 * scripts/plan-supabase-migrations.ts
 *
 * Dry-run: list pending migrations without applying anything.
 * No side effects. Safe to run at any time.
 *
 * Usage:
 *   npm run migrations:plan
 *   APP_ENV=staging npm run migrations:plan
 */

import path from "node:path";
import { getEnv, optionalEnv } from "../src/runtime/env.js";
import { planMigrations, formatMigrationReport } from "../src/supabase/migration-runner.js";

const env = getEnv();
const environment = optionalEnv(env, "APP_ENV") ?? "local";
const agentName = "test-agent";

const root = process.cwd();
const migrationsDir = path.join(root, "supabase", "migrations");
const ledgerPath = path.join(root, ".migration-ledger.json");

console.log(`Migration plan for: ${agentName}`);
console.log(`Environment:        ${environment}`);
console.log(`Migrations dir:     ${migrationsDir}`);
console.log("");

const plan = await planMigrations(migrationsDir, ledgerPath, agentName, environment);

if (plan.errors.length > 0) {
  console.error("Migration validation errors:");
  for (const error of plan.errors) console.error(`  ERROR: ${error}`);
  process.exit(1);
}

console.log(formatMigrationReport(plan, agentName));

if (plan.pending.length > 0) {
  console.log(
    `Run "npm run migrations:apply" with ALLOW_SUPABASE_MIGRATION_APPLY=true to apply.`
  );
  process.exit(0);
}
