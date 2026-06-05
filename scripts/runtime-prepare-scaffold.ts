/**
 * scripts/runtime-prepare-scaffold.ts
 *
 * Phase 18D-B PREP — prepare a generated scaffold for a DISPOSABLE runtime smoke. Local-only:
 * writes a disposable wrangler.toml + a gitignored credential template, validates the build.
 * Calls NO provider op, deploys nothing, uploads no secret, never advances the proposal, and
 * never prints a secret value (only status by env-var name).
 *
 * Usage:
 *   npm run runtime:prepare-scaffold -- --proposal <proposalId> --worker-name hartos-tax-agent-smoke --env staging
 * Optional:
 *   --force   overwrite the generated local wrangler.toml (non-empty cred values are still preserved)
 *   --build   actually run `npm install` (if needed) + `npm run build` in the scaffold
 */

import { prepareScaffold, ScaffoldPrepError, CRED_TEMPLATE_REL } from "../src/runtime-provision/scaffold-prep.js";
import type { ProposalRef } from "../src/cockpit/proposals/proposal-queue.js";

function arg(name: string): string | undefined {
  const pre = `--${name}=`;
  const eq = process.argv.find((a) => a.startsWith(pre));
  if (eq) return eq.slice(pre.length);
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--")) return process.argv[i + 1];
  return undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const proposal = arg("proposal") ?? arg("id");
const workerName = arg("worker-name");
const targetEnv = arg("env");

if (!proposal) { console.error("Missing --proposal <proposalId>."); process.exit(1); }
if (!workerName) { console.error("Missing --worker-name <name>."); process.exit(1); }
if (!targetEnv) { console.error("Missing --env <staging|test>."); process.exit(1); }

const ref: ProposalRef = { id: proposal };
const cwd = process.cwd();
const now = new Date().toISOString();

try {
  const r = await prepareScaffold({ cwd, ref, workerName, targetEnv, now, force: flag("force"), build: flag("build") });
  console.log("18D-B scaffold prep complete.\n");
  console.log("Generated:");
  console.log(`- Wrangler config:     ${r.wranglerPath}`);
  console.log(`- Credential template: ${r.credTemplatePath} ${r.credTemplateExisted ? "(merged into existing)" : "(new)"}\n`);
  console.log("Build:");
  console.log(`- node_modules:     ${r.build.nodeModules}`);
  console.log(`- npm run build:    ${r.build.npmBuild}`);
  console.log(`- dist/src/index.js: ${r.build.distEntrypoint}\n`);
  console.log("Credentials (status by name only — values never printed):");
  for (const c of r.credentials) console.log(`- ${c.key}: ${c.status}`);
  console.log("");
  console.log("Proposal:");
  console.log(`- status: ${r.proposalStatus} (unchanged)`);
  console.log(`- audit appended: ${r.auditAppended ? "runtime_scaffold_prep" : "no"}`);
  console.log(`- provider ops called: ${r.providerOpsCalled}`);
  console.log("- no secrets printed\n");
  console.log("Next:");
  for (const line of r.instructions) console.log(`  ${line}`);
  console.log(`\nFill values locally in: ${CRED_TEMPLATE_REL}`);
  process.exit(0);
} catch (err) {
  if (err instanceof ScaffoldPrepError) {
    console.error(`Scaffold prep refused: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
