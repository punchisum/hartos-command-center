/**
 * scripts/hartos-orchestrate.ts
 *
 * hartos:orchestrate — run the full local Orchestrator flow.
 * Local, deterministic, report-driven. No network. No mutation.
 *
 * Usage:
 *   npm run hartos:orchestrate -- --request="I want to build a tax specialist agent"
 */

import path from "node:path";
import { runOrchestrator, DEFAULT_REPORTS_DIR } from "../src/hartos/orchestrator.js";

function parseRequest(argv: string[]): string | null {
  const arg = argv.find((a) => a.startsWith("--request="));
  if (!arg) return null;
  return arg.slice("--request=".length).trim();
}

const request = parseRequest(process.argv.slice(2));
if (!request) {
  console.error('Usage: npm run hartos:orchestrate -- --request="<your request>"');
  process.exit(1);
}

const cwd = process.cwd();
const reportsDir = process.env["HARTOS_REPORTS_DIR"] ?? path.join(cwd, DEFAULT_REPORTS_DIR);

const result = await runOrchestrator(request, { cwd, reportsDir });

console.log(`\nHartOS Orchestrator: test-agent`);
console.log(`Request: ${result.request}`);
console.log(`Classification: ${result.classification.classification} (domain: ${result.classification.domain}, risk: ${result.classification.riskLevel})`);
console.log(`Strategy verdict: ${result.strategy ? result.strategy.verdict : "n/a"}`);
console.log(`CTO verdict: ${result.cto ? result.cto.technicalVerdict : "n/a"}`);
if (result.gap) {
  console.log(`Usable capabilities: ${result.gap.usableCapabilities.join(", ") || "none"}`);
  console.log(`Missing capabilities: ${result.gap.missingCapabilities.join(", ") || "none"}`);
}
if (result.reportPath) {
  console.log(`Report: ${result.reportPath}`);
}
console.log("");
