/**
 * scripts/release-compare.ts
 *
 * Compare the two most recent launch reports.
 * No mutations. Safe to run anytime.
 *
 * Usage: npm run release:compare
 */

import path from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { compareReleases, formatReleaseComparison } from "../src/launch/release-compare.js";

const agentName = "test-agent";
const root = process.cwd();
const reportsDir = path.join(root, "launch-reports");

console.log(`Release comparison: ${agentName}`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

const comparison = await compareReleases(reportsDir);
const formatted = formatReleaseComparison(comparison);
console.log(formatted);

// Write comparison report
await mkdir(reportsDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath = path.join(reportsDir, `release-compare-${ts}.md`);
await writeFile(outputPath, formatted, "utf8");
console.log(`Comparison written to: ${outputPath}`);
