/**
 * scripts/agent-scaffold-build.ts
 *
 * Phase 18A — Controlled execution / PR mode (LOCAL-ONLY). From an APPROVED-FOR-EXECUTION proposal,
 * scaffold a real agent repo (via the Agent Factory) onto a LOCAL git branch + commit + PR-prep
 * bundle. Pushes nothing, mutates no provider, creates no repo. Requires ALLOW_LOCAL_SCAFFOLD=true.
 *
 * Usage:
 *   ALLOW_LOCAL_SCAFFOLD=true npm run agent:scaffold-build -- --id=<proposal-id>
 *   ALLOW_LOCAL_SCAFFOLD=true npm run agent:scaffold-build -- --number=<n>
 */

import { runLocalScaffoldBuild, ScaffoldBuildPreconditionError } from "../src/execution/index.js";
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
  const r = await runLocalScaffoldBuild({ cwd, ref: parseRef(), now });
  console.log(`Local scaffold built: ${r.agentName} (spec ${r.specId})`);
  console.log(`Repo workdir: ${r.workDir}`);
  console.log(`Branch: ${r.branch} @ ${r.commitSha.slice(0, 10)} · ${r.files.length} files`);
  console.log(`PR bundle: ${r.prBodyPath} + ${r.patchPath}`);
  console.log(`pushed=${r.pushed} · providerMutations=${r.providerMutations} · executed=${r.executed} · secretsClean=${r.secretsClean}`);
  console.log("Nothing pushed, deployed, or provisioned. Review the PR bundle; pushing + PR-open is gated to 18B.");
} catch (err) {
  if (err instanceof ScaffoldBuildPreconditionError) {
    console.error(`Scaffold build refused: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
