/**
 * scripts/beezulbub-pack-generate.ts
 *
 * Generate a HartOS-compatible pack skeleton from an approved digest.
 *
 * Requires BOTH:
 *   - CLI flag: --approve-devour
 *   - Env var: BEEZULBUB_ALLOW_PACK_GENERATE=true
 *
 * Usage:
 *   BEEZULBUB_ALLOW_PACK_GENERATE=true npm run beezulbub:pack-generate -- --capability=dashboard_layout --from-latest --approve-devour
 *   BEEZULBUB_ALLOW_PACK_GENERATE=true npm run beezulbub:pack-generate -- --digest=beezulbub-reports/score-xxx.json --approve-devour
 *   BEEZULBUB_ALLOW_PACK_GENERATE=true npm run beezulbub:pack-generate -- --capability=dashboard_layout --from-latest --approve-devour --force
 */

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { generatePack } from "../src/beezulbub/pack-generator.js";
import { formatPackGenerateReport } from "../src/beezulbub/pack-report.js";
import { getEnv, optionalEnv } from "../src/runtime/env.js";

const root = process.cwd();
const reportsDir = path.join(root, "beezulbub-reports");

const args = process.argv.slice(2);
const capabilityArg = args.find((a) => a.startsWith("--capability="))?.replace("--capability=", "");
const digestArg = args.find((a) => a.startsWith("--digest="))?.replace("--digest=", "");
const fromLatest = args.includes("--from-latest");
const approveDevour = args.includes("--approve-devour");
const referencePack = args.includes("--reference-pack");
const force = args.includes("--force");
const packDirArg = args.find((a) => a.startsWith("--packs-dir="))?.replace("--packs-dir=", "");

const env = getEnv() as Record<string, string | undefined>;
const allowPackGenerate = optionalEnv(env, "BEEZULBUB_ALLOW_PACK_GENERATE") === "true";
const packOutputDir = packDirArg ?? optionalEnv(env, "BEEZULBUB_PACK_OUTPUT_DIR") ?? "packs";

console.log(`\nBeezulbub Pack Generate: test-agent`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Approval flag: ${approveDevour ? "✓ --approve-devour" : "✗ missing"}`);
console.log(`Gate env: ${allowPackGenerate ? "✓ BEEZULBUB_ALLOW_PACK_GENERATE=true" : "✗ not set"}`);
console.log("");

const result = await generatePack(
  {
    capability: capabilityArg,
    digestPath: digestArg ? path.resolve(root, digestArg) : undefined,
    fromLatest,
    approveDevour,
    force,
    allowPackGenerate,
    referencePack,
    packOutputDir,
  },
  "beezulbub-reports",
  root
);

const formatted = formatPackGenerateReport(result);
console.log(formatted);

await mkdir(reportsDir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(reportsDir, `pack-generate-${ts}.md`);
await writeFile(reportPath, formatted, "utf8");
console.log(`Generation report: ${reportPath}`);

if (result.status === "blocked_missing_approval") {
  console.log("");
  console.log("To approve pack generation, set:");
  console.log("  BEEZULBUB_ALLOW_PACK_GENERATE=true");
  console.log("  And pass: --approve-devour");
  process.exit(0);
}

if (result.status !== "generated") {
  process.exit(0);
}

console.log("");
console.log(`Pack generated at: ${result.packPath}`);
console.log(`Next: npm run beezulbub:pack-list`);
