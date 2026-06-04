/**
 * scripts/agent-scaffold-pr.ts
 *
 * Phase 18B — push the 18A-built scaffold branch + open a PR against an EXISTING GitHub repo.
 * GATED: with any gate closed it prints dry-run instructions and touches nothing. Node CLI only.
 * Creates no repo, merges nothing, provisions nothing, deploys nothing.
 *
 * Usage (all gates must be set on the host; never commit the token):
 *   ALLOW_GITHUB_PUSH=true CONFIRM_GITHUB_PR=true \
 *   HARTOS_GITHUB_TOKEN=<token> HARTOS_GITHUB_OWNER=<owner> HARTOS_GITHUB_REPO=<repo> \
 *   npm run agent:scaffold-pr -- --id=<proposal-id>
 */

import { runGithubPrMode, GithubPrPreconditionError } from "../src/execution/index.js";
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
  const r = await runGithubPrMode({ cwd, ref: parseRef(), now });
  if (r.mode === "dry_run") {
    console.log(`GitHub PR mode: DRY-RUN for ${r.agentName} (spec ${r.specId}). Nothing pushed.`);
    for (const line of r.instructions) console.log(`  ${line}`);
    process.exit(0);
  }
  console.log(`GitHub PR opened for ${r.agentName}: ${r.prUrl} (PR #${r.prNumber})`);
  console.log(`Branch ${r.branch} pushed. merged=${r.merged} · providerMutations=${r.providerMutations} · executed=${r.executed}`);
  console.log("Reviewable before merge. Merge + provider provisioning are later, separately-gated phases.");
} catch (err) {
  if (err instanceof GithubPrPreconditionError) {
    console.error(`GitHub PR mode refused: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
