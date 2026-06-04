/**
 * src/hartos/handover.ts
 *
 * Reads the latest Orchestrator JSON sidecar and produces a concise handover
 * for pasting into ChatGPT / Claude / Codex.
 *
 * Read-only. It degrades safely when no reports exist.
 */

import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type {
  HandoverResult,
  OrchestratorReportSidecar,
} from "./orchestrator-types.js";

export const DEFAULT_REPORTS_DIR = "hartos-reports";

export interface HandoverOptions {
  reportsDir?: string;
  cwd?: string;
}

/** Find the most recent orchestrator-*.json sidecar (lexicographic = chronological). */
async function findLatestSidecar(reportsDir: string): Promise<string | null> {
  if (!existsSync(reportsDir)) return null;
  let files: string[];
  try {
    files = await readdir(reportsDir);
  } catch {
    return null;
  }
  const sidecars = files
    .filter((f) => f.startsWith("orchestrator-") && f.endsWith(".json"))
    .sort()
    .reverse();
  if (sidecars.length === 0) return null;
  return path.join(reportsDir, sidecars[0]!);
}

function emptyHandover(): HandoverResult {
  return {
    request: null,
    classification: null,
    strategyVerdict: null,
    ctoVerdict: null,
    capabilityStatus: [],
    recommendedNextAction:
      "No prior orchestrator report found. Run: npm run hartos:orchestrate -- --request=\"<your request>\"",
    commandsToRunNext: ['npm run hartos:orchestrate -- --request="<your request>"'],
    risks: [],
    openQuestions: ["What is the next request to orchestrate?"],
    sourceReport: null,
  };
}

export async function generateHandover(
  options: HandoverOptions = {}
): Promise<HandoverResult> {
  const cwd = options.cwd ?? process.cwd();
  const reportsDir = options.reportsDir
    ? path.resolve(cwd, options.reportsDir)
    : path.resolve(cwd, DEFAULT_REPORTS_DIR);

  const sidecarPath = await findLatestSidecar(reportsDir);
  if (!sidecarPath) return emptyHandover();

  let sidecar: OrchestratorReportSidecar;
  try {
    sidecar = JSON.parse(await readFile(sidecarPath, "utf8")) as OrchestratorReportSidecar;
  } catch {
    return emptyHandover();
  }

  const capabilityStatus: string[] = [];
  for (const cap of sidecar.usableCapabilities) capabilityStatus.push(`${cap}: usable`);
  for (const cap of sidecar.missingCapabilities) capabilityStatus.push(`${cap}: missing`);
  if (capabilityStatus.length === 0) capabilityStatus.push("No specific capabilities tracked for this request.");

  const openQuestions: string[] = [];
  if (sidecar.missingCapabilities.length > 0) {
    openQuestions.push(`How will missing capabilities be acquired: ${sidecar.missingCapabilities.join(", ")}?`);
  }
  if (sidecar.strategyVerdict === "NEEDS_MORE_EVIDENCE") {
    openQuestions.push("What evidence is needed before committing to this build?");
  }
  if (openQuestions.length === 0) openQuestions.push("Any blockers before starting phase 1?");

  return {
    request: sidecar.request,
    classification: sidecar.classification,
    strategyVerdict: sidecar.strategyVerdict,
    ctoVerdict: sidecar.technicalVerdict,
    capabilityStatus,
    recommendedNextAction: sidecar.recommendedNextAction,
    commandsToRunNext: sidecar.commandsToRunNext,
    risks: sidecar.risks,
    openQuestions,
    sourceReport: path.basename(sidecarPath),
  };
}
