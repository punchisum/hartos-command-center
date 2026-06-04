/**
 * scripts/apply-supabase-migrations.ts
 *
 * Apply pending Supabase migrations.
 *
 * Gates:
 *   ALLOW_SUPABASE_MIGRATION_APPLY=true   required for any apply
 *   CONFIRM_PRODUCTION_DEPLOY=true         required for production
 *
 * Execution mode: generates a combined SQL report file and prints apply instructions.
 * Actual SQL execution uses Supabase CLI or dashboard — never auto-executed here.
 * Marks migrations as applied in the local ledger after confirmed apply.
 *
 * Usage:
 *   ALLOW_SUPABASE_MIGRATION_APPLY=true npm run migrations:apply
 *   ALLOW_SUPABASE_MIGRATION_APPLY=true APP_ENV=staging npm run migrations:apply
 *   ALLOW_SUPABASE_MIGRATION_APPLY=true CONFIRM_PRODUCTION_DEPLOY=true APP_ENV=production npm run migrations:apply
 */

import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { getEnv, optionalEnv } from "../src/runtime/env.js";
import {
  planMigrations,
  markApplied,
  formatMigrationReport,
} from "../src/supabase/migration-runner.js";

const env = getEnv();
const environment = optionalEnv(env, "APP_ENV") ?? "local";
const agentName = "test-agent";

// ─── Gate checks ─────────────────────────────────────────────────────────────

if (env.ALLOW_SUPABASE_MIGRATION_APPLY !== "true") {
  console.log("Migration apply is gated.");
  console.log("");
  console.log("To apply migrations:");
  console.log("  1. Run 'npm run migrations:plan' to review what is pending.");
  console.log("  2. Set ALLOW_SUPABASE_MIGRATION_APPLY=true to proceed.");
  console.log("  3. For production, also set CONFIRM_PRODUCTION_DEPLOY=true.");
  console.log("");
  console.log("No changes made.");
  process.exit(0);
}

if (environment === "production" && env.CONFIRM_PRODUCTION_DEPLOY !== "true") {
  console.log("Production migration apply requires CONFIRM_PRODUCTION_DEPLOY=true.");
  console.log("");
  console.log("This is an extra safety gate for production.");
  console.log("Set CONFIRM_PRODUCTION_DEPLOY=true once you have reviewed the migration plan.");
  console.log("");
  console.log("No changes made.");
  process.exit(0);
}

// ─── Plan ─────────────────────────────────────────────────────────────────────

const root = process.cwd();
const migrationsDir = path.join(root, "supabase", "migrations");
const ledgerPath = path.join(root, ".migration-ledger.json");
const reportsDir = path.join(root, "migration-reports");

console.log(`Applying migrations for: ${agentName}`);
console.log(`Environment: ${environment}`);
console.log("");

const plan = await planMigrations(migrationsDir, ledgerPath, agentName, environment);

if (plan.errors.length > 0) {
  console.error("Migration validation failed. Fix errors before applying:");
  for (const error of plan.errors) console.error(`  ERROR: ${error}`);
  process.exit(1);
}

if (plan.pending.length === 0) {
  console.log("No pending migrations. Already up to date.");
  process.exit(0);
}

console.log(`Pending migrations: ${plan.pending.length}`);
for (const m of plan.pending) console.log(`  - ${m.filename}`);
console.log("");

// ─── Generate combined SQL report ─────────────────────────────────────────────

await mkdir(reportsDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const reportFilename = `migration-${environment}-${ts}.sql`;
const reportPath = path.join(reportsDir, reportFilename);

const sqlParts: string[] = [
  `-- Migration report: ${agentName}`,
  `-- Environment: ${environment}`,
  `-- Generated: ${new Date().toISOString()}`,
  `-- Apply this file via: supabase db push  OR  paste into Supabase SQL editor`,
  ``,
];

for (const m of plan.pending) {
  sqlParts.push(`-- ─── ${m.filename} ${"─".repeat(Math.max(0, 60 - m.filename.length))}`);
  const sql = await readFile(m.fullPath, "utf8");
  sqlParts.push(sql.trim());
  sqlParts.push(``);
}

await writeFile(reportPath, sqlParts.join("\n"), "utf8");

// ─── Also write a markdown plan report ───────────────────────────────────────

const mdReport = formatMigrationReport(plan, agentName);
const mdReportPath = path.join(reportsDir, `migration-${environment}-${ts}.md`);
await writeFile(mdReportPath, mdReport, "utf8");

// ─── Print instructions ───────────────────────────────────────────────────────

console.log(`Combined SQL written to: ${reportPath}`);
console.log(`Migration report written to: ${mdReportPath}`);
console.log("");
console.log("Apply the migrations using one of:");
console.log("  Option 1 — Supabase CLI (recommended):");
console.log("    supabase db push");
console.log("");
console.log("  Option 2 — Supabase Dashboard:");
console.log(`    Paste the contents of ${reportFilename} into the SQL editor.`);
console.log("");
console.log("After applying, mark migrations as applied in the ledger:");
console.log("  Run this script again with --mark-applied flag:");
console.log("  ALLOW_SUPABASE_MIGRATION_APPLY=true npm run migrations:apply -- --mark-applied");
console.log("");

// ─── Mark applied if --mark-applied flag is set ───────────────────────────────

if (process.argv.includes("--mark-applied")) {
  const filenames = plan.pending.map((m) => m.filename);
  await markApplied(ledgerPath, filenames, agentName, environment);
  console.log(`Marked ${filenames.length} migration(s) as applied in ledger: ${ledgerPath}`);
  for (const f of filenames) console.log(`  - ${f}`);
}
