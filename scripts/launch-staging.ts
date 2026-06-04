/**
 * scripts/launch-staging.ts
 *
 * One-command staging launch orchestration.
 *
 * Runs the full staging launch sequence:
 *   readiness → provision plan → verify → provision auto → deployment check → smoke → report → rollback
 *
 * Respects all existing Phase 5-7 gates.
 * If gates are missing, steps are skipped safely.
 * If steps return manual_required, they are recorded — launch status becomes partial/blocked.
 *
 * Usage:
 *   npm run launch:staging
 *
 * With all gates:
 *   ALLOW_AUTO_PROVISION=true CONFIRM_STAGING_PROVISION=true \
 *   ALLOW_GITHUB_PROVISION=true ALLOW_CLOUDFLARE_DEPLOY=true \
 *   ALLOW_TELEGRAM_WEBHOOK_REGISTER=true ALLOW_TRIGGER_TASK_REGISTER=true \
 *   npm run launch:staging
 */

import path from "node:path";
import { runStagingLaunch } from "../src/launch/staging-launch.js";
import { formatLaunchReport, writeLaunchReport } from "../src/launch/report.js";
import { getEnv, optionalEnv } from "../src/runtime/env.js";

const agentName = "test-agent";
const root = process.cwd();
const reportsDir = path.join(root, "launch-reports");

console.log(`\n${"═".repeat(60)}`);
console.log(`  HartOS Staging Launch: ${agentName}`);
console.log(`  ${new Date().toISOString()}`);
console.log(`${"═".repeat(60)}\n`);

const report = await runStagingLaunch({ agentName, reportsDir });

console.log(formatLaunchReport(report));

const { mdPath, jsonPath } = await writeLaunchReport(report, reportsDir);
console.log(`Launch report:  ${mdPath}`);
console.log(`Launch summary: ${jsonPath}`);
if (report.rollbackPlanPath) {
  console.log(`Rollback plan:  ${report.rollbackPlanPath}`);
}

console.log(`\n${"═".repeat(60)}`);
console.log(`  Status: ${report.launchStatus.toUpperCase()}`);
console.log(`  Next:   ${report.nextAction}`);
console.log(`${"═".repeat(60)}\n`);

// Phase 10: Optional Telegram launch notification (gated)
const runtimeEnv = getEnv() as Record<string, string | undefined>;
if (runtimeEnv["ALLOW_LAUNCH_NOTIFICATIONS"] === "true") {
  const chatId = optionalEnv(runtimeEnv, "DEBUG_CHANNEL_ID");
  const botToken = optionalEnv(runtimeEnv, "TELEGRAM_BOT_TOKEN");
  if (chatId && botToken) {
    const msg =
      `🚀 ${agentName} staging launch: ${report.launchStatus}\n` +
      `${report.safeSummary}\n` +
      (report.manualRequiredSteps.length > 0
        ? `Manual required: ${report.manualRequiredSteps.length} step(s)`
        : "No manual steps remaining.");
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: msg }),
      });
    } catch {
      // Non-fatal — notification failure must not fail the launch
    }
  }
}

// Exit with non-zero only on actual failure — blocked/partial are acceptable
if (report.launchStatus === "failed") {
  process.exit(1);
}
