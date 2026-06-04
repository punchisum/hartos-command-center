/**
 * scripts/beezulbub-digest.ts
 *
 * Digest a local repository — detect stack, capabilities, poison, and score.
 *
 * Usage:
 *   npm run beezulbub:digest -- --repo=tests/fixtures/beezulbub/clean-dashboard
 *   npm run beezulbub:digest -- --repo=/path/to/local/repo --target=dashboard_layout
 *
 * For a GitHub URL: clone first, then use local path:
 *   git clone https://github.com/user/repo /tmp/repo
 *   npm run beezulbub:digest -- --repo=/tmp/repo
 */

import path from "node:path";
import { digestLocalRepo } from "../src/beezulbub/digest.js";
import { formatDigestReport, writeDigestReport } from "../src/beezulbub/report.js";

const args = process.argv.slice(2);
const repoArg = args.find((a) => a.startsWith("--repo="));
const targetArg = args.find((a) => a.startsWith("--target="));

const reposDir = path.join(process.cwd(), "beezulbub-reports");

if (!repoArg) {
  console.error("Usage: npm run beezulbub:digest -- --repo=<local-path> [--target=<capability>]");
  console.error("");
  console.error("For a GitHub URL:");
  console.error("  git clone https://github.com/user/repo /tmp/repo");
  console.error("  npm run beezulbub:digest -- --repo=/tmp/repo");
  process.exit(1);
}

const localPath = path.resolve(process.cwd(), repoArg.replace("--repo=", ""));
const targetCapability = targetArg?.replace("--target=", "");

console.log(`\nBeezulbub Digest: test-agent`);
console.log(`Repo: ${localPath}`);
if (targetCapability) console.log(`Target capability: ${targetCapability}`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

// Check if it looks like a URL (not a local path)
const repoValue = repoArg.replace("--repo=", "");
if (repoValue.startsWith("http://") || repoValue.startsWith("https://") || repoValue.startsWith("git@")) {
  console.log("⚠ GitHub URL detected.");
  console.log("Phase 11A does not support live URL ingestion.");
  console.log("Clone the repo locally first:");
  console.log(`  git clone ${repoValue} /tmp/repo`);
  console.log(`  npm run beezulbub:digest -- --repo=/tmp/repo`);
  console.log("");
  console.log("manual_required");
  process.exit(0);
}

try {
  const digest = await digestLocalRepo({ localPath, targetCapability });
  const formatted = formatDigestReport(digest);

  console.log(formatted);

  const { mdPath, jsonPath } = await writeDigestReport(digest, reposDir);
  console.log(`Digest report: ${mdPath}`);
  console.log(`Score JSON:    ${jsonPath}`);
  console.log("");
  console.log(`Verdict: ${digest.recommendedVerdict}`);
  console.log(`Overall score: ${digest.score.overall}/10`);
  console.log(`Capabilities: ${digest.usefulCapabilities.length}`);
  console.log(`Poison flags: ${digest.poisonFlags.length}`);
  console.log("");
  console.log("Next: npm run beezulbub:report");
} catch (err) {
  console.error(`Digest failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
