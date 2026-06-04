/**
 * scripts/beezulbub-report.ts
 *
 * Show the latest Beezulbub digest report.
 *
 * Usage: npm run beezulbub:report
 */

import path from "node:path";
import { readFile } from "node:fs/promises";
import { showLatestReport } from "../src/beezulbub/report.js";

const reportsDir = path.join(process.cwd(), "beezulbub-reports");

console.log(`\nBeezulbub Report: test-agent`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

const latestPath = await showLatestReport(reportsDir);

if (!latestPath) {
  console.log("No Beezulbub reports found.");
  console.log("");
  console.log("Run these commands first:");
  console.log("  npm run beezulbub:scout -- --target=dashboard_layout");
  console.log("  npm run beezulbub:digest -- --repo=tests/fixtures/beezulbub/clean-dashboard");
  process.exit(0);
}

const content = await readFile(latestPath, "utf8");
console.log(content);
console.log(`Report file: ${latestPath}`);
