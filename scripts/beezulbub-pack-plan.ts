/**
 * scripts/beezulbub-pack-plan.ts
 *
 * Plan which pack to generate from the latest digest/batch report.
 * No files generated under packs/ during planning.
 *
 * Usage:
 *   npm run beezulbub:pack-plan
 *   npm run beezulbub:pack-plan -- --digest=beezulbub-reports/score-xxx.json
 *   npm run beezulbub:pack-plan -- --batch=beezulbub-reports/batch-digest-xxx.json
 */

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { buildPackPlan, formatPackPlan } from "../src/beezulbub/pack-plan.js";

const root = process.cwd();
const reportsDir = path.join(root, "beezulbub-reports");

const args = process.argv.slice(2);
const digestArg = args.find((a) => a.startsWith("--digest="))?.replace("--digest=", "");
const batchArg = args.find((a) => a.startsWith("--batch="))?.replace("--batch=", "");

const explicitPath = digestArg
  ? path.resolve(root, digestArg)
  : batchArg
    ? path.resolve(root, batchArg)
    : undefined;

console.log(`\nBeezulbub Pack Plan: test-agent`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Source: ${explicitPath ?? "latest digest/batch report"}`);
console.log("");

const plan = await buildPackPlan(reportsDir, explicitPath);

if (!plan) {
  console.log("No digest reports found.");
  console.log("");
  console.log("Run these first:");
  console.log("  npm run beezulbub:digest -- --repo=tests/fixtures/beezulbub/clean-dashboard");
  console.log("  npm run beezulbub:batch -- --repos=tests/fixtures/beezulbub/batch-repos.json");
  process.exit(0);
}

const formatted = formatPackPlan(plan);
console.log(formatted);

await mkdir(reportsDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(reportsDir, `pack-plan-${ts}.md`);
await writeFile(reportPath, formatted, "utf8");

console.log(`Pack plan written to: ${reportPath}`);
console.log("");
console.log(`Note: No files were generated under packs/ during planning.`);
