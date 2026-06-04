/**
 * scripts/agent-scaffold-dryrun.ts
 *
 * Phase 17D — the Node execution host, in report-only mode. From an APPROVED-FOR-EXECUTION
 * agent-creation proposal, write LOCAL dry-run artifacts (spec draft, structure, .env.example,
 * draft migration/cloudflare config, provider plan, checklist) into a gitignored workdir, plus a
 * closed-gate provision dry-run. Creates NO repo/project/bot, deploys nothing, pushes nothing.
 *
 * Usage:
 *   npm run agent:scaffold-dryrun -- --id=<proposal-id>
 *   npm run agent:scaffold-dryrun -- --number=<n>
 */

import { runLocalScaffoldDryRun, DryRunPreconditionError } from "../src/execution/index.js";
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
  const result = await runLocalScaffoldDryRun({ cwd, ref: parseRef(), now });
  console.log(`Local scaffold dry-run: ${result.agentName} (spec ${result.specId})`);
  console.log(`Workdir: ${result.outDir}`);
  console.log(`Artifacts (${result.artifacts.length}):`);
  for (const a of result.artifacts) console.log(`  - ${a.relPath} (${a.bytes} bytes)`);
  console.log(
    `Provider dry-run: ${result.providerDryRun.mutatingSteps} mutating step(s), ` +
      `all blocked = ${result.providerDryRun.allMutationsBlocked}.`
  );
  console.log(`executed=${result.executed} · secretsClean=${result.secretsClean} · proposal unchanged (still approved_for_execution).`);
  console.log("Nothing was created, deployed, or pushed. Review the CHECKLIST.md, then proceed to 18A (gated).");
} catch (err) {
  if (err instanceof DryRunPreconditionError) {
    console.error(`Dry-run refused: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
