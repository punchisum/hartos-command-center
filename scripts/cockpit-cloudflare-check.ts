/**
 * scripts/cockpit-cloudflare-check.ts
 *
 * cockpit:cloudflare:check — validate the hosted-cockpit runtime files, config
 * templates, env PRESENCE, and gate status. No deploy, no mutation, no secrets
 * printed (presence only). Writes a report under cloudflare-cockpit-reports/.
 *
 * Usage:
 *   npm run cockpit:cloudflare:check
 */

import { existsSync } from "node:fs";
import path from "node:path";
import {
  buildDeployPlan,
  writeCloudflareCockpitReport,
  DEFAULT_CLOUDFLARE_REPORTS_DIR,
  type CloudflareCheckResult,
} from "../src/runtime/cloudflare-deploy-bridge.js";

const cwd = process.cwd();
const env = process.env as Record<string, string | undefined>;

const runtimeFiles = [
  "src/runtime/cloudflare-cockpit-worker.ts",
  "src/runtime/cloudflare-deploy-bridge.ts",
  "src/runtime/cloudflare-env.ts",
  "src/runtime/cloudflare-response.ts",
  "src/runtime/cloudflare-security.ts",
  "src/runtime/cloudflare-cockpit-types.ts",
];
const missingRuntimeFiles = runtimeFiles.filter((f) => !existsSync(path.join(cwd, f)));

const check: CloudflareCheckResult = {
  runtimeFilesPresent: missingRuntimeFiles.length === 0,
  missingRuntimeFiles,
  configPresent: {
    wranglerExample: existsSync(path.join(cwd, "wrangler.toml.example")),
    devVarsExample: existsSync(path.join(cwd, ".dev.vars.example")),
  },
};

const plan = buildDeployPlan(env, "check");
const { mdPath, jsonPath } = await writeCloudflareCockpitReport(
  path.join(cwd, DEFAULT_CLOUDFLARE_REPORTS_DIR),
  plan,
  check
);

console.log("\nHartOS Cloudflare Cockpit — Check: test-agent");
console.log(`Runtime files present: ${check.runtimeFilesPresent}`);
if (missingRuntimeFiles.length) console.log(`  missing: ${missingRuntimeFiles.join(", ")}`);
console.log(`Config: wrangler.toml.example=${check.configPresent.wranglerExample} .dev.vars.example=${check.configPresent.devVarsExample}`);
console.log(`Gate status: ${plan.gate.status}`);
if (plan.gate.missingGates.length) console.log(`  missing gates: ${plan.gate.missingGates.join(", ")}`);
console.log("Env presence (names only, no values):");
for (const e of plan.envPresence) console.log(`  ${e.name}: ${e.present ? "present" : "missing"}`);
console.log(`Report: ${path.relative(cwd, mdPath)}`);
console.log(`Sidecar: ${path.relative(cwd, jsonPath)}`);
console.log("");
