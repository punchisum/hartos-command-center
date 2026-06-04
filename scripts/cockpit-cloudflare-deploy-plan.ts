/**
 * scripts/cockpit-cloudflare-deploy-plan.ts
 *
 * cockpit:cloudflare:deploy-plan — write a deployment plan report (routes,
 * env presence, gate status, security checklist, Cloudflare Access checklist,
 * deploy/health/rollback steps). No mutation, no deploy, no secrets.
 *
 * Usage:
 *   npm run cockpit:cloudflare:deploy-plan
 */

import path from "node:path";
import {
  buildDeployPlan,
  writeCloudflareCockpitReport,
  DEFAULT_CLOUDFLARE_REPORTS_DIR,
} from "../src/runtime/cloudflare-deploy-bridge.js";

const cwd = process.cwd();
const env = process.env as Record<string, string | undefined>;

const plan = buildDeployPlan(env, "deploy-plan");
const { mdPath, jsonPath } = await writeCloudflareCockpitReport(
  path.join(cwd, DEFAULT_CLOUDFLARE_REPORTS_DIR),
  plan
);

console.log("\nHartOS Cloudflare Cockpit — Deploy Plan: test-agent");
console.log(`Gate status: ${plan.gate.status}`);
if (plan.gate.missingGates.length) console.log(`  missing: ${plan.gate.missingGates.join(", ")}`);
console.log(`Runtime mode: ${plan.runtimeMode} | Action execution: ${plan.actionExecution} | Mutation endpoints: ${plan.mutationEndpoints}`);
console.log("Cloudflare Access: required before production exposure (see CLOUDFLARE_ACCESS_SETUP.md).");
console.log(`Report: ${path.relative(cwd, mdPath)}`);
console.log(`Sidecar: ${path.relative(cwd, jsonPath)}`);
console.log("");
