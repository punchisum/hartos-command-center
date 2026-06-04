/**
 * scripts/launch-report.ts
 *
 * Generate or display the latest launch report.
 * Reads from launch-reports/ if reports exist.
 * Otherwise shows current provider status.
 *
 * Usage:
 *   npm run launch:report
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { runStagingLaunch } from "../src/launch/staging-launch.js";
import { formatLaunchReport, writeLaunchReport } from "../src/launch/report.js";

const agentName = "test-agent";
const root = process.cwd();
const reportsDir = path.join(root, "launch-reports");

console.log(`Launch report: ${agentName}`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

// If existing reports, show the latest one
if (existsSync(reportsDir)) {
  const files = (await readdir(reportsDir))
    .filter((f) => f.startsWith("staging-launch-") && f.endsWith(".md"))
    .sort()
    .reverse();

  if (files.length > 0) {
    const latestPath = path.join(reportsDir, files[0]!);
    console.log(`Latest report: ${latestPath}`);
    console.log("");
    const content = await readFile(latestPath, "utf8");
    console.log(content);
    process.exit(0);
  }
}

// No existing report — generate a new one (read-only mode: no provider mutations)
console.log("No existing launch report found. Generating current status report...");
console.log("");

// Run with all gates closed so no mutations occur
const closedEnv: Record<string, string | undefined> = {
  ...process.env as Record<string, string | undefined>,
  ALLOW_AUTO_PROVISION: undefined,
  CONFIRM_STAGING_PROVISION: undefined,
};

const report = await runStagingLaunch({ agentName, reportsDir, env: closedEnv });
const formatted = formatLaunchReport(report);
console.log(formatted);

const { mdPath } = await writeLaunchReport(report, reportsDir);
console.log(`Report written to: ${mdPath}`);
