/**
 * scripts/beezulbub-pack-promote.ts
 *
 * beezulbub:pack-promote — Promote a pack to a higher lifecycle status.
 *
 * Usage:
 *   npm run beezulbub:pack-promote -- --pack=packs/my-pack --to=verified --approve-promote
 *
 * Requires:
 *   - BEEZULBUB_ALLOW_PACK_PROMOTE=true
 *   - --approve-promote flag
 */

import path from "node:path";
import { promotepack } from "../src/beezulbub/pack-promotion.js";
import type { PromoteTarget } from "../src/beezulbub/pack-promotion.js";

const args = process.argv.slice(2);
const packArg = args.find((a) => a.startsWith("--pack="));
const toArg = args.find((a) => a.startsWith("--to="));
const approvePromote = args.includes("--approve-promote");
const allowPackPromote = process.env["BEEZULBUB_ALLOW_PACK_PROMOTE"] === "true";

if (!packArg || !toArg) {
  console.error("Usage: npm run beezulbub:pack-promote -- --pack=<path> --to=<status> --approve-promote");
  console.error("Requires BEEZULBUB_ALLOW_PACK_PROMOTE=true");
  process.exit(1);
}

const cwd = process.cwd();
const packPath = path.resolve(cwd, packArg.replace("--pack=", ""));
const targetStatus = toArg.replace("--to=", "") as PromoteTarget;
const ledgerPath = process.env["BEEZULBUB_PROVENANCE_LEDGER_PATH"]
  ?? path.join(cwd, "capabilities", "provenance-ledger.json");
const registryPath = process.env["BEEZULBUB_CAPABILITY_REGISTRY_PATH"]
  ?? path.join(cwd, "capabilities", "capability-registry.json");

const result = await promotepack({
  packPath,
  targetStatus,
  approvePromote,
  allowPackPromote,
  ledgerPath,
  registryPath,
  cwd,
});

if (result.status === "promoted") {
  console.log(`✅ Pack promoted: ${result.packName}`);
  console.log(`   ${result.fromStatus} → ${result.toStatus}`);
} else {
  console.error(`❌ Promotion failed: ${result.status}`);
  console.error(`   ${result.message}`);
  process.exit(1);
}
