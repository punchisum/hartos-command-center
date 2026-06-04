/**
 * scripts/read-models-status.ts
 *
 * read-models:status — build the read-only read-model registry summary and
 * write a report under read-model-reports/. Reads read-models.local.json if
 * present; otherwise shows a safe unconfigured state. Read models are disabled
 * by default; a live Supabase read happens only when enabled AND env present.
 * The read client has no mutation methods. No secrets are printed.
 *
 * Usage:
 *   npm run read-models:status
 */

import path from "node:path";
import { buildReadModelRegistrySummary, writeReadModelReport, DEFAULT_READ_MODEL_REPORTS_DIR } from "../src/read-models/index.js";

const cwd = process.cwd();
const summary = await buildReadModelRegistrySummary({ cwd });
const reportsDir = path.join(cwd, DEFAULT_READ_MODEL_REPORTS_DIR);
const { mdPath, jsonPath } = await writeReadModelReport(reportsDir, summary);

console.log("\nHartOS Read Models — Status: test-agent");
console.log(`Config present: ${summary.configPresent} (${summary.configPath ?? "unconfigured"})`);
console.log(`Configured: ${summary.configuredReadModels} | Enabled: ${summary.enabledReadModels}`);
for (const s of summary.summaries) {
  console.log(`  - ${s.id} (${s.type}): ${s.status}`);
}
if (summary.missingEnv.length > 0) {
  console.log(`Missing env (names only): ${summary.missingEnv.join(", ")}`);
}
if (!summary.configPresent) {
  console.log("\nNo read-models.local.json found. Copy read-models.example.json to get started.");
}
console.log(`Report: ${path.relative(cwd, mdPath)}`);
console.log(`Sidecar: ${path.relative(cwd, jsonPath)}`);
console.log("");
