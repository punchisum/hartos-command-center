/**
 * scripts/command-center-cards.ts
 *
 * command-center:cards — write the card registry report (+ JSON sidecar) under
 * command-center-reports/, annotated with the local read model status.
 *
 * Read-only. No network. No mutation. Degrades safely when no reports exist.
 *
 * Usage:
 *   npm run command-center:cards
 */

import path from "node:path";
import { buildCommandCenterSnapshot, resolveReportsDir } from "../src/command-center/command-center.js";
import { formatCardRegistryReport, writeReport, writeSidecar } from "../src/command-center/command-center-report.js";

const cwd = process.cwd();
const reportsDir = resolveReportsDir(cwd, process.env["COMMAND_CENTER_REPORTS_DIR"]);

const snapshot = await buildCommandCenterSnapshot({ cwd });
const content = formatCardRegistryReport(snapshot.contract.cards, snapshot.readModels);

const reportPath = await writeReport(reportsDir, "card-registry", content);
const sidecarPath = await writeSidecar(reportsDir, "card-registry", {
  cards: snapshot.contract.cards,
  readModels: snapshot.readModels,
});

console.log("\nHartOS Command Center — Card Registry: test-agent");
console.log(`Cards: ${snapshot.contract.cards.length}`);
console.log(`Report: ${path.relative(cwd, reportPath)}`);
console.log(`Sidecar: ${path.relative(cwd, sidecarPath)}`);
console.log("");
