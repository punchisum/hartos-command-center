/**
 * scripts/beezulbub-pack-verify.ts
 *
 * beezulbub:pack-verify — Verify a pack's structure and readiness.
 *
 * Usage:
 *   npm run beezulbub:pack-verify -- --pack=packs/my-pack
 */

import path from "node:path";
import { verifyPack, formatVerifyReport } from "../src/beezulbub/pack-verifier.js";

const args = process.argv.slice(2);
const packArg = args.find((a) => a.startsWith("--pack="));

if (!packArg) {
  console.error("Usage: npm run beezulbub:pack-verify -- --pack=<pack-path>");
  process.exit(1);
}

const cwd = process.cwd();
const packPath = path.resolve(cwd, packArg.replace("--pack=", ""));
const ledgerPath = process.env["BEEZULBUB_PROVENANCE_LEDGER_PATH"]
  ?? path.join(cwd, "capabilities", "provenance-ledger.json");

const result = await verifyPack(packPath, ledgerPath, cwd);
console.log(formatVerifyReport(result));

if (result.status !== "passed") {
  process.exit(1);
}
