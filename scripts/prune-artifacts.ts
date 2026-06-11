/**
 * scripts/prune-artifacts.ts — CLI for the artifact-retention planner.
 *
 * DRY-RUN BY DEFAULT (propose-don't-act). Prints the per-directory plan; deletes
 * nothing unless invoked with --apply. `--keep N` overrides the retention window.
 *
 *   npm run reports:prune            → show what WOULD be pruned
 *   npm run reports:prune -- --apply → actually delete the prune candidates
 */

import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  ARTIFACT_DIRS,
  DEFAULT_KEEP_PER_DIR,
  describeRetentionPlan,
  planRetention,
  type ArtifactDirInventory,
} from "../src/ops/artifact-retention.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const keepIdx = args.indexOf("--keep");
const keep = keepIdx >= 0 ? Number(args[keepIdx + 1]) : DEFAULT_KEEP_PER_DIR;

if (!Number.isFinite(keep) || keep < 1) {
  console.error("--keep must be a positive integer");
  process.exit(1);
}

const inventory: ArtifactDirInventory[] = [];
for (const dir of ARTIFACT_DIRS) {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    continue; // directory absent — nothing to plan
  }
  const files = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (st.isFile()) files.push({ name, mtimeMs: st.mtimeMs, bytes: st.size });
    } catch {
      // raced away — skip
    }
  }
  inventory.push({ dir, files });
}

const plan = planRetention(inventory, keep);
console.log(describeRetentionPlan(plan));

if (!apply) {
  console.log("\nDRY RUN — nothing deleted. Re-run with --apply to prune.");
  process.exit(0);
}

let deleted = 0;
for (const d of plan.dirs) {
  for (const f of d.prune) {
    try {
      unlinkSync(join(d.dir, f.name));
      deleted++;
    } catch (err) {
      console.error(`failed to delete ${d.dir}/${f.name}: ${(err as Error).message}`);
    }
  }
}
console.log(`\nAPPLIED — deleted ${deleted}/${plan.totalPrune} prune candidate(s).`);
