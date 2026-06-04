/**
 * scripts/hartos-strategy-review.ts
 *
 * hartos:strategy-review — run the strategy review (Prophet) module.
 * Local, deterministic, report-driven. No network. No mutation.
 *
 * Usage:
 *   npm run hartos:strategy-review -- --request="I want to build a command center"
 */

import path from "node:path";
import { reviewStrategy } from "../src/hartos/strategy-review.js";
import { detectCapabilityGaps } from "../src/hartos/capability-gap.js";
import { formatStrategyReport, writeReport } from "../src/hartos/orchestrator-report.js";
import { DEFAULT_REPORTS_DIR } from "../src/hartos/orchestrator.js";

function parseRequest(argv: string[]): string | null {
  const arg = argv.find((a) => a.startsWith("--request="));
  if (!arg) return null;
  return arg.slice("--request=".length).trim();
}

const request = parseRequest(process.argv.slice(2));
if (!request) {
  console.error('Usage: npm run hartos:strategy-review -- --request="<your request>"');
  process.exit(1);
}

const cwd = process.cwd();
const reportsDir = process.env["HARTOS_REPORTS_DIR"] ?? path.join(cwd, DEFAULT_REPORTS_DIR);

// Feed missing-foundation awareness into the strategy review (read-only).
const gap = await detectCapabilityGaps(request, { cwd });
const result = reviewStrategy(request, { missingFoundationCapabilities: gap.missingCapabilities });

const content = formatStrategyReport(result);
const reportPath = await writeReport(reportsDir, "strategy-review", content);

console.log(`\nHartOS Strategy Review: test-agent`);
console.log(`Request: ${result.request}`);
console.log(`Verdict: ${result.verdict}`);
console.log(`Expected leverage: ${result.expectedLeverage} | Risk: ${result.risk} | Maintenance: ${result.maintenanceBurden}`);
console.log(`Reason: ${result.reason}`);
if (result.simplerAlternative) console.log(`Simpler alternative: ${result.simplerAlternative}`);
console.log(`Recommended next action: ${result.recommendedNextAction}`);
console.log(`Report: ${reportPath}`);
console.log("");
