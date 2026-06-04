/**
 * scripts/beezulbub-pack-conflicts.ts
 *
 * beezulbub:pack-conflicts — Detect conflicts across all packs.
 *
 * Usage:
 *   npm run beezulbub:pack-conflicts
 *   npm run beezulbub:pack-conflicts -- --packs=packs/a,packs/b
 */

import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { detectConflicts, formatConflictReport } from "../src/beezulbub/pack-conflicts.js";

const args = process.argv.slice(2);
const packsArg = args.find((a) => a.startsWith("--packs="));
const cwd = process.cwd();
const packsDir = path.join(cwd, "packs");

let packPaths: string[] = [];

if (packsArg) {
  packPaths = packsArg.replace("--packs=", "").split(",").map((p) => path.resolve(cwd, p.trim()));
} else {
  if (existsSync(packsDir)) {
    const entries = await readdir(packsDir, { withFileTypes: true });
    packPaths = entries
      .filter((e) => e.isDirectory())
      .map((e) => path.join(packsDir, e.name));
  }
}

if (packPaths.length === 0) {
  console.log("No packs found to check for conflicts.");
  process.exit(0);
}

const report = await detectConflicts(packPaths);
console.log(formatConflictReport(report));

if (report.status === "conflicts_found") {
  process.exit(1);
}
