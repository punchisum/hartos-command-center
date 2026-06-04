/**
 * scripts/cockpit-snapshot.ts
 *
 * cockpit:snapshot — build the local cockpit state, render static HTML, and
 * write snapshot reports (+ JSON sidecar + .html) under cockpit-reports/.
 * Does NOT start a server. Read-only, local, deterministic, no mutation.
 *
 * Usage:
 *   npm run cockpit:snapshot
 */

import path from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { buildCockpitSnapshot, resolveCockpitReportsDir } from "../src/cockpit/cockpit.js";
import { writeSnapshotReport, assertNoSecretsInReport } from "../src/cockpit/cockpit-report.js";

const cwd = process.cwd();
const reportsDir = resolveCockpitReportsDir(cwd, process.env["COCKPIT_REPORTS_DIR"]);

const { state, html } = await buildCockpitSnapshot({ cwd });
const { mdPath, jsonPath } = await writeSnapshotReport(reportsDir, state);

assertNoSecretsInReport(html);
await mkdir(reportsDir, { recursive: true });
const htmlPath = path.join(reportsDir, `cockpit-snapshot-${state.generatedAt.replace(/[:.]/g, "-")}.html`);
await writeFile(htmlPath, html, "utf8");

console.log("\nHartOS Local Visible Cockpit — Snapshot: test-agent");
console.log(`Cards: ${state.summary.cardCount} across ${state.summary.groups.join(", ")}`);
console.log(`Missing sources: ${state.summary.missingSourceCount} | Forbidden actions: ${state.summary.forbiddenActionCount}`);
console.log(`Next recommended command: ${state.summary.nextRecommendedCommand}`);
console.log(`Report: ${path.relative(cwd, mdPath)}`);
console.log(`Sidecar: ${path.relative(cwd, jsonPath)}`);
console.log(`HTML: ${path.relative(cwd, htmlPath)}`);
console.log("");
