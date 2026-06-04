/**
 * scripts/agent-scaffold-pr-rollback.ts
 *
 * Phase 18B — roll back an opened PR. DEFAULT: prints manual instructions (close PR + delete remote
 * branch); no remote mutation. Only with ALLOW_GITHUB_REMOTE_ROLLBACK=true (+ token/owner/repo) does
 * it close the PR (never merges) and delete the remote branch. Node CLI only.
 *
 * Usage:
 *   npm run agent:scaffold-pr-rollback -- --id=<proposal-id>
 *   ALLOW_GITHUB_REMOTE_ROLLBACK=true HARTOS_GITHUB_TOKEN=... HARTOS_GITHUB_OWNER=... HARTOS_GITHUB_REPO=... \
 *     npm run agent:scaffold-pr-rollback -- --id=<proposal-id>
 */

import { runGithubPrRollback, GithubPrPreconditionError } from "../src/execution/index.js";
import type { ProposalRef } from "../src/cockpit/proposals/proposal-queue.js";

function parseRef(): ProposalRef {
  const id = process.argv.find((a) => a.startsWith("--id="))?.replace("--id=", "");
  const numArg = process.argv.find((a) => a.startsWith("--number="))?.replace("--number=", "");
  if (id) return { id };
  if (numArg) return { number: Number.parseInt(numArg, 10) };
  throw new Error("Provide --id=<proposal-id> or --number=<n>.");
}

const cwd = process.cwd();
const now = new Date().toISOString();

try {
  const r = await runGithubPrRollback({ cwd, ref: parseRef(), now });
  if (r.mode === "rolled_back") {
    console.log(`Remote rollback done: closed PR #${r.prNumber ?? "?"}, deleted branch ${r.branch}.`);
  } else {
    console.log("Remote rollback is manual by default (auto-rollback gate closed). Steps:");
    for (const line of r.instructions) console.log(`  ${line}`);
  }
} catch (err) {
  if (err instanceof GithubPrPreconditionError) {
    console.error(`Rollback refused: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
