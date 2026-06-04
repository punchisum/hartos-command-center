/**
 * scripts/hartos-build-plan.ts
 *
 * hartos:build-plan — generate a structured build plan.
 * Local, deterministic, report-driven. No network. No mutation.
 *
 * Usage:
 *   npm run hartos:build-plan -- --request="Build a dashboard cockpit"
 */

import path from "node:path";
import { generateBuildPlan } from "../src/hartos/build-plan.js";
import { formatBuildPlan, writeReport } from "../src/hartos/orchestrator-report.js";
import { DEFAULT_REPORTS_DIR } from "../src/hartos/orchestrator.js";

function parseRequest(argv: string[]): string | null {
  const arg = argv.find((a) => a.startsWith("--request="));
  if (!arg) return null;
  return arg.slice("--request=".length).trim();
}

const request = parseRequest(process.argv.slice(2));
if (!request) {
  console.error('Usage: npm run hartos:build-plan -- --request="<your request>"');
  process.exit(1);
}

const cwd = process.cwd();
const reportsDir = process.env["HARTOS_REPORTS_DIR"] ?? path.join(cwd, DEFAULT_REPORTS_DIR);

const result = await generateBuildPlan(request, { cwd });

const content = formatBuildPlan(result);
const reportPath = await writeReport(reportsDir, "build-plan", content);

console.log(`\nHartOS Build Plan: test-agent`);
console.log(`Request: ${result.request}`);
console.log(`Strategy verdict: ${result.strategy ? result.strategy.verdict : "n/a"}`);
console.log(`CTO verdict: ${result.cto ? result.cto.technicalVerdict : "n/a"}`);
console.log(`Build sequence:`);
for (const phase of result.phaseBreakdown) {
  console.log(`  ${phase.order}. ${phase.title}`);
}
console.log(`Do NOT build: ${result.doNotBuild.length} item(s) — see report.`);
console.log(`Report: ${reportPath}`);
console.log("");
