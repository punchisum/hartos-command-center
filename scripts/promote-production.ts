/**
 * scripts/promote-production.ts
 *
 * Production promotion — full production launch with staging proof check.
 *
 * Blocks safely if:
 *   - ALLOW_PRODUCTION_PROMOTION not set
 *   - CONFIRM_PRODUCTION_DEPLOY not set
 *   - No staging launch report exists
 *   - Staging report status is not success/partial-with-override
 *
 * Usage:
 *   ALLOW_PRODUCTION_PROMOTION=true CONFIRM_PRODUCTION_DEPLOY=true \
 *   ALLOW_AUTO_PROVISION=true npm run promote:production
 */

import path from "node:path";
import { runProductionLaunch } from "../src/launch/production-launch.js";
import { formatLaunchReport, writeLaunchReport } from "../src/launch/report.js";

const agentName = "test-agent";
const root = process.cwd();
const reportsDir = path.join(root, "launch-reports");

console.log(`\n${"═".repeat(60)}`);
console.log(`  HartOS Production Promotion: ${agentName}`);
console.log(`  ${new Date().toISOString()}`);
console.log(`${"═".repeat(60)}\n`);

const report = await runProductionLaunch({ agentName, reportsDir });
console.log(formatLaunchReport(report));

const { mdPath, jsonPath } = await writeLaunchReport(report, reportsDir);
console.log(`Production report: ${mdPath}`);
console.log(`Report summary:    ${jsonPath}`);
if (report.rollbackPlanPath) {
  console.log(`Rollback plan:     ${report.rollbackPlanPath}`);
}

console.log(`\n${"═".repeat(60)}`);
console.log(`  Status: ${report.launchStatus.toUpperCase()}`);
console.log(`  Next:   ${report.nextAction}`);
console.log(`${"═".repeat(60)}\n`);

if (report.launchStatus === "failed") process.exit(1);
