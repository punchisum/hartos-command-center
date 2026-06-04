/**
 * scripts/cockpit-cloudflare-deploy.ts
 *
 * cockpit:cloudflare:deploy — GATED deploy. It NEVER deploys automatically.
 *
 * If any gate is missing it prints `blocked_missing_gate`, writes a report, and
 * exits 0 (no deployment). If ALL gates are present, it is a SAFE STUB: it emits
 * the exact manual wrangler steps and writes a report — it still does not invoke
 * wrangler itself (deploy is a deliberate human action). This honors the Factory
 * gate doctrine and guarantees no real deploy happens during tests/CI.
 *
 * Required gates:
 *   ALLOW_AUTO_PROVISION=true
 *   CONFIRM_CLOUDFLARE_DEPLOY=true
 *   ALLOW_CLOUDFLARE_COCKPIT_DEPLOY=true
 *   CLOUDFLARE_API_TOKEN present
 *   CLOUDFLARE_ACCOUNT_ID present
 *
 * Usage:
 *   npm run cockpit:cloudflare:deploy
 */

import path from "node:path";
import {
  buildDeployPlan,
  checkCockpitDeployGates,
  writeCloudflareCockpitReport,
  DEFAULT_CLOUDFLARE_REPORTS_DIR,
} from "../src/runtime/cloudflare-deploy-bridge.js";

const cwd = process.cwd();
const env = process.env as Record<string, string | undefined>;

const gate = checkCockpitDeployGates(env);
const plan = buildDeployPlan(env, "deploy");
const { mdPath } = await writeCloudflareCockpitReport(path.join(cwd, DEFAULT_CLOUDFLARE_REPORTS_DIR), plan);

console.log("\nHartOS Cloudflare Cockpit — Deploy: test-agent");

if (gate.status === "blocked_missing_gate") {
  console.log("Status: blocked_missing_gate");
  console.log(`Missing: ${gate.missingGates.join(", ")}`);
  console.log("No deployment occurred. Set all gates and required env, then re-run.");
  console.log(`Report: ${path.relative(cwd, mdPath)}`);
  console.log("");
  // Safe exit — gated, no deploy.
  process.exit(0);
}

// Gates open: emit the exact manual steps. We still do NOT invoke wrangler.
console.log("Status: ready (gates open) — manual deploy required.");
console.log("Run these steps yourself to deploy (this script does not deploy for you):");
for (const step of plan.deploymentSteps) console.log(`  - ${step}`);
console.log("\nAfter deploy, verify health:");
for (const step of plan.healthCheckPlan) console.log(`  - ${step}`);
console.log("\nConfigure Cloudflare Access before sharing the URL (CLOUDFLARE_ACCESS_SETUP.md).");
console.log(`Report: ${path.relative(cwd, mdPath)}`);
console.log("");
