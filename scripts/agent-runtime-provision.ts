/**
 * scripts/agent-runtime-provision.ts
 *
 * Phase 18D — deploy a generated agent's RUNTIME layer (Cloudflare Worker + secrets + Trigger.dev
 * tasks + Telegram webhook) from its local scaffold workdir. GATED: with any gate closed it prints
 * a dry-run report (plan + pre-flight probes + rollback plan) and touches no provider. Node CLI only.
 * Creates no project/account, applies no Supabase migrations, merges nothing. Production is hard-refused.
 *
 * Usage (set gates on the host; never commit secrets):
 *   # Dry-run (default — safe):
 *   npm run agent:runtime-provision -- --id=<proposal-id>
 *
 *   # Real deploy to a staging/test target:
 *   ALLOW_RUNTIME_PROVISION=true CONFIRM_RUNTIME_MUTATION=true HARTOS_TARGET_ENV=staging \
 *   CONFIRM_CLOUDFLARE_WORKER_NAME=<worker> CONFIRM_TELEGRAM_BOT_ID=<bot id> \
 *   HARTOS_RUNTIME_WORKER_URL=<deployed url> CLOUDFLARE_API_TOKEN=<...> TELEGRAM_BOT_TOKEN=<...> \
 *   TRIGGER_SECRET_KEY=<...> SUPABASE_SERVICE_ROLE_KEY=<...> TELEGRAM_WEBHOOK_SECRET=<...> \
 *   npm run agent:runtime-provision -- --id=<proposal-id>
 */

import { runRuntimeProvision, RuntimeProvisionPreconditionError } from "../src/execution/agent-runtime-provision.js";
import type { ProposalRef } from "../src/cockpit/proposals/proposal-queue.js";

function parseRef(): ProposalRef {
  const id = process.argv.find((a) => a.startsWith("--id="))?.replace("--id=", "");
  const numArg = process.argv.find((a) => a.startsWith("--number="))?.replace("--number=", "");
  if (id) return { id };
  if (numArg) return { number: Number.parseInt(numArg, 10) };
  throw new Error("Provide --id=<proposal-id> or --number=<n>.");
}

const cwd = process.cwd();
const now = new Date().toISOString();

try {
  const r = await runRuntimeProvision({ cwd, ref: parseRef(), now });
  console.log(
    `Runtime provision: ${r.mode.toUpperCase()} for ${r.agentName} (spec ${r.specId}) — ` +
      `worker=${r.workerName ?? "?"}, env=${r.targetEnv ?? "?"}, advanced=${r.advanced}, webhookReverted=${r.webhookReverted}.`
  );
  for (const line of r.instructions) console.log(`  ${line}`);
  console.log("  Steps:");
  for (const s of r.steps) {
    const mark = s.status === "ok" ? "✓" : s.status === "skipped" ? "·" : s.status === "reverted" ? "↩" : "✗";
    console.log(`    ${mark} ${s.step}: ${s.message}`);
  }
  console.log(`  Report:        ${r.reportPath}`);
  console.log(`  Rollback plan: ${r.rollbackPlanPath}`);
  process.exit(r.mode === "deploy_failed" ? 1 : 0);
} catch (err) {
  if (err instanceof RuntimeProvisionPreconditionError) {
    console.error(`Runtime provision refused: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
