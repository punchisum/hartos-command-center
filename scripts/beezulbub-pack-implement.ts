/**
 * scripts/beezulbub-pack-implement.ts
 *
 * beezulbub:pack-implement — Generate HartOS-native implementation stubs for a skeleton pack.
 *
 * Usage:
 *   BEEZULBUB_ALLOW_PACK_IMPLEMENT=true \
 *     npm run beezulbub:pack-implement -- --pack=packs/my-pack --approve-implementation
 *
 * Requires:
 *   - BEEZULBUB_ALLOW_PACK_IMPLEMENT=true
 *   - --approve-implementation flag
 *
 * Does NOT copy third-party source code.
 */

import path from "node:path";
import { implementPack } from "../src/beezulbub/pack-implementation-engine.js";
import { formatImplementReport } from "../src/beezulbub/pack-implementation-report.js";

const args = process.argv.slice(2);
const packArg = args.find((a) => a.startsWith("--pack="));
const approveImplementation = args.includes("--approve-implementation");
const allowPackImplement = process.env["BEEZULBUB_ALLOW_PACK_IMPLEMENT"] === "true";

if (!packArg) {
  console.error("Usage: BEEZULBUB_ALLOW_PACK_IMPLEMENT=true npm run beezulbub:pack-implement -- --pack=<path> --approve-implementation");
  process.exit(1);
}

const cwd = process.cwd();
const packPath = path.resolve(cwd, packArg.replace("--pack=", ""));
const ledgerPath = process.env["BEEZULBUB_PROVENANCE_LEDGER_PATH"]
  ?? path.join(cwd, "capabilities", "provenance-ledger.json");
const registryPath = process.env["BEEZULBUB_CAPABILITY_REGISTRY_PATH"]
  ?? path.join(cwd, "capabilities", "capability-registry.json");

const result = await implementPack({
  packPath,
  approveImplementation,
  allowPackImplement,
  ledgerPath,
  registryPath,
  cwd,
});

console.log(formatImplementReport(result));

if (result.status !== "implemented") {
  process.exit(1);
}
