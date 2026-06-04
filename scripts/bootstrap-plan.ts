/**
 * scripts/bootstrap-plan.ts
 *
 * Show full bootstrap plan. No mutations. Safe to run anytime.
 *
 * Usage: npm run bootstrap:plan
 */

import path from "node:path";
import { getEnv } from "../src/runtime/env.js";
import { checkBootstrap } from "../src/bootstrap/bootstrap-check.js";
import { formatBootstrapPlan, writeBootstrapReport } from "../src/bootstrap/bootstrap-report.js";

const root = process.cwd();
const env = getEnv() as Record<string, string | undefined>;
const reportsDir = path.join(root, "bootstrap-reports");

console.log(`Bootstrap plan: test-agent`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

const plan = await checkBootstrap(env);
const formatted = formatBootstrapPlan(plan);
console.log(formatted);

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const planPath = await writeBootstrapReport(formatted, reportsDir, `bootstrap-plan-${ts}.md`);
console.log(`Plan written to: ${planPath}`);
