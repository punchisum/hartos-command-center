/**
 * scripts/hartos-handover.ts
 *
 * hartos:handover — read the latest orchestrator report and produce a concise
 * handover for pasting into ChatGPT / Claude / Codex.
 * Read-only. Degrades safely when no reports exist.
 *
 * Usage:
 *   npm run hartos:handover
 */

import path from "node:path";
import { generateHandover } from "../src/hartos/handover.js";
import { formatHandoverReport, writeReport } from "../src/hartos/orchestrator-report.js";
import { DEFAULT_REPORTS_DIR } from "../src/hartos/orchestrator.js";

const cwd = process.cwd();
const reportsDir = process.env["HARTOS_REPORTS_DIR"] ?? path.join(cwd, DEFAULT_REPORTS_DIR);

const result = await generateHandover({ cwd, reportsDir });

const content = formatHandoverReport(result);
const reportPath = await writeReport(reportsDir, "handover", content);

console.log(`\nHartOS Handover: test-agent`);
console.log(`Current request: ${result.request ?? "(none — run hartos:orchestrate first)"}`);
console.log(`Classification: ${result.classification ?? "n/a"}`);
console.log(`Strategy verdict: ${result.strategyVerdict ?? "n/a"}`);
console.log(`CTO verdict: ${result.ctoVerdict ?? "n/a"}`);
console.log(`Recommended next action: ${result.recommendedNextAction}`);
console.log(`Report: ${reportPath}`);
console.log("");
