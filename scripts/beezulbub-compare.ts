/**
 * scripts/beezulbub-compare.ts
 *
 * Compare candidates from existing batch/digest reports.
 * No network required.
 *
 * Usage: npm run beezulbub:compare
 */

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import {
  compareFromReports,
  formatComparisonReport,
} from "../src/beezulbub/candidate-compare.js";

const reportsDir = path.join(process.cwd(), "beezulbub-reports");

console.log(`\nBeezulbub Compare: test-agent`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

const report = await compareFromReports(reportsDir);
const formatted = formatComparisonReport(report);
console.log(formatted);

if (report.candidates.length > 0) {
  await mkdir(reportsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(reportsDir, `comparison-${ts}.md`);
  await writeFile(outputPath, formatted, "utf8");
  console.log(`Comparison written to: ${outputPath}`);
} else {
  console.log("Run 'npm run beezulbub:digest' or 'npm run beezulbub:batch' first to generate reports.");
}
