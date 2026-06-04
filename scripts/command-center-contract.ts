/**
 * scripts/command-center-contract.ts
 *
 * command-center:contract — assemble the Command Center data contract, build the
 * read model from LOCAL sources, and write a data-contract report (+ JSON
 * sidecar) under command-center-reports/.
 *
 * Read-only. No network. No provider/Supabase/pack mutation. Degrades safely
 * when no reports exist.
 *
 * Usage:
 *   npm run command-center:contract
 */

import path from "node:path";
import { buildCommandCenterSnapshot, resolveReportsDir } from "../src/command-center/command-center.js";
import { formatDataContractReport, writeReport, writeSidecar } from "../src/command-center/command-center-report.js";

const cwd = process.cwd();
const reportsDir = resolveReportsDir(cwd, process.env["COMMAND_CENTER_REPORTS_DIR"]);

const snapshot = await buildCommandCenterSnapshot({ cwd });
const content = formatDataContractReport(snapshot.contract, snapshot.readModels);

const reportPath = await writeReport(reportsDir, "data-contract", content);
const sidecarPath = await writeSidecar(reportsDir, "data-contract", {
  contract: snapshot.contract,
  readModels: snapshot.readModels,
});

console.log("\nHartOS Command Center — Data Contract: test-agent");
console.log(`Cards: ${snapshot.contract.cardCount}`);
console.log(`Groups: ${snapshot.contract.groups.join(", ")}`);
console.log(`Report: ${path.relative(cwd, reportPath)}`);
console.log(`Sidecar: ${path.relative(cwd, sidecarPath)}`);
console.log("");
