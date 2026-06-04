/**
 * scripts/command-center-plan.ts
 *
 * command-center:plan — write the cockpit plan report (+ JSON sidecar) under
 * command-center-reports/: read-only/approval/manual/forbidden action states,
 * the next recommended local command, missing sources, and future cockpit
 * phases.
 *
 * Read-only. No network. No mutation. Builds NO UI (Phase 11G is contract only).
 *
 * Usage:
 *   npm run command-center:plan
 */

import path from "node:path";
import { buildCommandCenterSnapshot, resolveReportsDir } from "../src/command-center/command-center.js";
import { formatCockpitPlanReport, writeReport, writeSidecar } from "../src/command-center/command-center-report.js";

const cwd = process.cwd();
const reportsDir = resolveReportsDir(cwd, process.env["COMMAND_CENTER_REPORTS_DIR"]);

const snapshot = await buildCommandCenterSnapshot({ cwd });
const content = formatCockpitPlanReport(snapshot.plan);

const reportPath = await writeReport(reportsDir, "cockpit-plan", content);
const sidecarPath = await writeSidecar(reportsDir, "cockpit-plan", snapshot.plan);

console.log("\nHartOS Command Center — Cockpit Plan: test-agent");
console.log(`Next recommended command: ${snapshot.plan.nextRecommendedCommand}`);
console.log(`Forbidden actions: ${snapshot.plan.forbiddenActions.join(", ") || "none"}`);
console.log(`Report: ${path.relative(cwd, reportPath)}`);
console.log(`Sidecar: ${path.relative(cwd, sidecarPath)}`);
console.log("");
