/**
 * scripts/hartos-cto-review.ts
 *
 * hartos:cto-review — run the CTO technical review module.
 * Reads capability registry / provenance ledger / pack manifests (read-only).
 * No network. No mutation.
 *
 * Usage:
 *   npm run hartos:cto-review -- --request="Build a receipt OCR agent"
 */

import path from "node:path";
import { reviewCto } from "../src/hartos/cto-review.js";
import { formatCtoReport, writeReport } from "../src/hartos/orchestrator-report.js";
import { DEFAULT_REPORTS_DIR } from "../src/hartos/orchestrator.js";

function parseRequest(argv: string[]): string | null {
  const arg = argv.find((a) => a.startsWith("--request="));
  if (!arg) return null;
  return arg.slice("--request=".length).trim();
}

const request = parseRequest(process.argv.slice(2));
if (!request) {
  console.error('Usage: npm run hartos:cto-review -- --request="<your request>"');
  process.exit(1);
}

const cwd = process.cwd();
const reportsDir = process.env["HARTOS_REPORTS_DIR"] ?? path.join(cwd, DEFAULT_REPORTS_DIR);

const result = await reviewCto(request, { cwd });

const content = formatCtoReport(result);
const reportPath = await writeReport(reportsDir, "cto-review", content);

console.log(`\nHartOS CTO Review: test-agent`);
console.log(`Request: ${result.request}`);
console.log(`Technical verdict: ${result.technicalVerdict}`);
console.log(`Existing (usable): ${result.existingCapabilities.join(", ") || "none"}`);
console.log(`Planning-only: ${result.planningOnlyCapabilities.join(", ") || "none"}`);
console.log(`Missing: ${result.missingCapabilities.join(", ") || "none"}`);
console.log(`Report: ${reportPath}`);
console.log("");
