/**
 * scripts/rollback-plan.ts
 *
 * Generate a rollback runbook based on current deployment state.
 * No side effects. Never prints secrets.
 *
 * Usage:
 *   npm run rollback:plan
 *   APP_ENV=staging npm run rollback:plan
 */

import path from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getEnv, optionalEnv } from "../src/runtime/env.js";
import { loadLedger } from "../src/supabase/migration-runner.js";

const env = getEnv();
const environment = optionalEnv(env, "APP_ENV") ?? "local";
const agentName = "test-agent";

const root = process.cwd();
const ledgerPath = path.join(root, ".migration-ledger.json");
const reportsDir = path.join(root, "migration-reports");

const ledger = existsSync(ledgerPath) ? await loadLedger(ledgerPath) : null;
const appliedMigrations = ledger?.applied ?? [];

const lines: string[] = [
  `# Rollback Plan: ${agentName}`,
  ``,
  `Environment: ${environment}`,
  `Generated: ${new Date().toISOString()}`,
  ``,
  `## Purpose`,
  ``,
  `Use this plan if a deployment needs to be reversed.`,
  `Work through each section in order.`,
  `Each section requires human approval before execution.`,
  ``,
  `---`,
  ``,
  `## 1. Cloudflare Worker rollback`,
  ``,
  `Redeploy the previous Worker version:`,
  ``,
  `\`\`\`bash`,
  `# Option A — via wrangler rollback (if available in your wrangler version):`,
  `wrangler rollback --env ${environment === "production" ? "production" : "staging"}`,
  ``,
  `# Option B — redeploy previous commit:`,
  `git checkout <previous-release-tag>`,
  `ALLOW_CLOUDFLARE_DEPLOY=true npm run deploy:${environment === "production" ? "production" : "staging"}`,
  `\`\`\``,
  ``,
  `After rollback, verify health:`,
  `\`\`\`bash`,
  `npm run verify:cloudflare`,
  `\`\`\``,
  ``,
  `---`,
  ``,
  `## 2. Telegram webhook rollback`,
  ``,
  `If the webhook URL changed, re-register the previous URL:`,
  ``,
  `\`\`\`bash`,
  `TELEGRAM_WEBHOOK_URL=<previous-url> \\`,
  `ALLOW_TELEGRAM_WEBHOOK_REGISTER=true \\`,
  `npm run telegram:register-webhook`,
  `\`\`\``,
  ``,
  `---`,
  ``,
  `## 3. Supabase migration rollback`,
  ``,
  `Applied migrations (in this environment):`,
];

if (appliedMigrations.length === 0) {
  lines.push(`  (none — ledger is empty or not found)`);
} else {
  for (const migration of appliedMigrations) {
    lines.push(`  - ${migration}`);
  }
}

lines.push(
  ``,
  `Database migrations are NOT automatically reversed.`,
  ``,
  `For each migration that must be reversed:`,
  `1. Write a reverting migration (e.g. 000099_revert_<name>.sql).`,
  `2. Review it with the database owner.`,
  `3. Apply via Supabase CLI or dashboard — NOT via this script.`,
  `4. Mark as applied: ALLOW_SUPABASE_MIGRATION_APPLY=true npm run migrations:apply -- --mark-applied`,
  ``,
  `⚠ Data migrations may not be safely reversible. Consult the database owner before reverting.`,
  ``,
  `---`,
  ``,
  `## 4. Data repair`,
  ``,
  `If partial data mutations occurred during the failed deployment:`,
  ``,
  `1. Check Supabase debug_events table for the failed run:`,
  `\`\`\`sql`,
  `select trace_id, route, stage, outcome, failure_code, metadata`,
  `from public.debug_events`,
  `where outcome = 'error'`,
  `order by created_at desc`,
  `limit 20;`,
  `\`\`\``,
  ``,
  `2. Identify affected rows in the main tables.`,
  `3. Reset their status to the last known good state.`,
  `4. Re-trigger the workflow manually if needed.`,
  ``,
  `---`,
  ``,
  `## 5. Verify rollback`,
  ``,
  `\`\`\`bash`,
  `npm run verify`,
  `npm run smoke:local`,
  `npm run deployment:check`,
  `\`\`\``,
  ``,
  `---`,
  ``,
  `## 6. Post-rollback report`,
  ``,
  `After rollback is confirmed:`,
  ``,
  `\`\`\`bash`,
  `npm run release:report`,
  `\`\`\``,
  ``,
  `Write a handover doc explaining what happened and what was rolled back.`,
  ``
);

const plan = lines.join("\n");
console.log(plan);

await mkdir(reportsDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath = path.join(reportsDir, `rollback-plan-${environment}-${ts}.md`);
await writeFile(outputPath, plan, "utf8");
console.log(`Rollback plan written to: ${outputPath}`);
