/**
 * scripts/beezulbub-scout.ts
 *
 * Scout candidate repositories for a given capability target.
 * Phase 11A: fixture/local mode.
 * Phase 11B: --live flag for GitHub API search (requires BEEZULBUB_ALLOW_NETWORK=true).
 *
 * Usage:
 *   npm run beezulbub:scout -- --target=dashboard_layout
 *   npm run beezulbub:scout -- --target=receipt_ocr --candidates=my-candidates.json
 *   npm run beezulbub:scout -- --target=dashboard_layout --live
 *   npm run beezulbub:scout -- --target=dashboard_layout --live --limit=5
 */

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { scoutCandidates, formatScoutResult } from "../src/beezulbub/scout.js";

const args = process.argv.slice(2);
const targetArg = args.find((a) => a.startsWith("--target="));
const candidatesArg = args.find((a) => a.startsWith("--candidates="));
const liveFlag = args.includes("--live");
const limitArg = args.find((a) => a.startsWith("--limit="));

const target = targetArg ? targetArg.replace("--target=", "") : "dashboard_layout";
const candidatesPath = candidatesArg
  ? path.resolve(process.cwd(), candidatesArg.replace("--candidates=", ""))
  : undefined;
const limit = limitArg ? parseInt(limitArg.replace("--limit=", ""), 10) : 10;

const reportsDir = path.join(process.cwd(), "beezulbub-reports");

const mode = liveFlag ? "live (GitHub API)" : candidatesPath ? "custom candidates" : "built-in fixture";
console.log(`\nBeezulbub Scout: test-agent`);
console.log(`Target: ${target}`);
console.log(`Mode: ${mode}`);
if (liveFlag) console.log(`Limit: ${limit}`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

const result = await scoutCandidates({ target, candidatesPath, live: liveFlag, limit });
const formatted = formatScoutResult(result);

console.log(formatted);

await mkdir(reportsDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(reportsDir, `scout-${ts}.md`);
await writeFile(reportPath, formatted, "utf8");
console.log(`Scout report written to: ${reportPath}`);
console.log("");
console.log("Next: npm run beezulbub:digest -- --repo=<local-path>");
