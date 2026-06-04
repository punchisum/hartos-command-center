/**
 * scripts/beezulbub-score.ts
 *
 * Show the score from the latest digest report.
 *
 * Usage: npm run beezulbub:score
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { formatScore } from "../src/beezulbub/score.js";
import type { BeezulbubScore } from "../src/beezulbub/types.js";

const reportsDir = path.join(process.cwd(), "beezulbub-reports");

console.log(`\nBeezulbub Score: test-agent`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

if (!existsSync(reportsDir)) {
  console.log("No beezulbub-reports/ directory found.");
  console.log("Run 'npm run beezulbub:digest' first.");
  process.exit(0);
}

const scoreFiles = (await readdir(reportsDir))
  .filter((f) => f.startsWith("score-") && f.endsWith(".json"))
  .sort()
  .reverse();

if (scoreFiles.length === 0) {
  console.log("No score files found in beezulbub-reports/.");
  console.log("Run 'npm run beezulbub:digest -- --repo=<path>' first.");
  process.exit(0);
}

const latestScore = path.join(reportsDir, scoreFiles[0]!);
const raw = await readFile(latestScore, "utf8");
const data = JSON.parse(raw) as {
  repoName?: string;
  verdict?: string;
  score?: BeezulbubScore;
  summary?: string;
};

console.log(`Repo: ${data.repoName ?? "unknown"}`);
console.log(`Verdict: ${data.verdict ?? "unknown"}`);
console.log("");

if (data.score) {
  console.log(formatScore(data.score));
} else {
  console.log("Score data not available.");
}

console.log("");
if (data.summary) console.log(`Summary: ${data.summary}`);
console.log(`Source: ${latestScore}`);
