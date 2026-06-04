/**
 * scripts/beezulbub-batch.ts
 *
 * Batch digest multiple local repositories.
 *
 * Usage:
 *   npm run beezulbub:batch -- --repos=tests/fixtures/beezulbub/batch-repos.json --target=dashboard_layout
 */

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import {
  loadBatchConfig,
  runBatchDigest,
  formatBatchReport,
} from "../src/beezulbub/batch-digest.js";

const args = process.argv.slice(2);
const reposArg = args.find((a) => a.startsWith("--repos="));
const targetArg = args.find((a) => a.startsWith("--target="));

const reportsDir = path.join(process.cwd(), "beezulbub-reports");

if (!reposArg) {
  console.error("Usage: npm run beezulbub:batch -- --repos=<batch-config.json> [--target=<capability>]");
  console.error("");
  console.error("Example:");
  console.error("  npm run beezulbub:batch -- --repos=tests/fixtures/beezulbub/batch-repos.json");
  process.exit(1);
}

const reposPath = path.resolve(process.cwd(), reposArg.replace("--repos=", ""));
const targetOverride = targetArg?.replace("--target=", "");

console.log(`\nBeezulbub Batch: test-agent`);
console.log(`Config: ${reposPath}`);
if (targetOverride) console.log(`Target override: ${targetOverride}`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

const config = await loadBatchConfig(reposPath);
if (targetOverride) config.target = targetOverride;

console.log(`Target: ${config.target}`);
console.log(`Repos: ${config.repos.length}`);
console.log("");

const result = await runBatchDigest(config);

for (const r of result.results) {
  const icon = r.status === "digested" ? "✓" : r.status === "failed" ? "✗" : "○";
  const verdict = r.digest ? ` — ${r.digest.recommendedVerdict} (${r.digest.score.overall}/10)` : ` — ${r.status}`;
  console.log(`  ${icon} ${r.repo.name}${verdict}`);
}
console.log("");

const formatted = formatBatchReport(result);
console.log(formatted);

await mkdir(reportsDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const mdPath = path.join(reportsDir, `batch-digest-${ts}.md`);
const jsonPath = path.join(reportsDir, `batch-digest-${ts}.json`);

await writeFile(mdPath, formatted, "utf8");
const safeJson = {
  target: result.target,
  timestamp: result.timestamp,
  status: result.status,
  ranking: result.ranking,
  topCandidate: result.topCandidate,
  recommendation: result.recommendation,
};
await writeFile(jsonPath, JSON.stringify(safeJson, null, 2) + "\n", "utf8");

console.log(`Batch report: ${mdPath}`);
console.log(`Batch JSON:   ${jsonPath}`);
console.log("");
console.log(`Status: ${result.status}`);
console.log(`Top candidate: ${result.topCandidate ?? "none"}`);
console.log("");
console.log("Next: npm run beezulbub:compare");
