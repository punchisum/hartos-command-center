/**
 * src/hartos/orchestrator.ts
 *
 * The Orchestrator — command router / chief of staff.
 *
 * Full local flow:
 *   1. Parse request
 *   2. Classify request
 *   3. Run strategy review (if needed)
 *   4. Run CTO review (if engineering/build request)
 *   5. Detect capability gaps
 *   6. Generate build plan
 *   7. Write report (+ safe JSON sidecar for handover)
 *
 * It recommends commands but NEVER executes them. It does NOT mutate
 * packs, registries, providers, or Supabase.
 *
 * Safety: No mutation. No network. No provider calls. Recommendations only.
 */

import path from "node:path";
import type {
  OrchestratorResult,
  OrchestratorReportSidecar,
  BuildPlanResult,
} from "./orchestrator-types.js";
import { classifyRequest } from "./request-classifier.js";
import { reviewStrategy } from "./strategy-review.js";
import { reviewCto } from "./cto-review.js";
import { detectCapabilityGaps } from "./capability-gap.js";
import { generateBuildPlan } from "./build-plan.js";
import {
  formatOrchestratorReport,
  writeReport,
  writeSidecar,
} from "./orchestrator-report.js";

export const DEFAULT_REPORTS_DIR = "hartos-reports";

export interface OrchestratorOptions {
  registryPath?: string;
  ledgerPath?: string;
  packsDir?: string;
  cwd?: string;
  reportsDir?: string;
  /** Default true. When false, no files are written (used by tests). */
  writeReport?: boolean;
}

/** Derive the commands Hart should run next, based on the build plan. */
function commandsToRunNext(buildPlan: BuildPlanResult | null): string[] {
  if (!buildPlan) {
    return ["npm run hartos:orchestrate -- --request=\"<your request>\""];
  }
  const cmds: string[] = [];
  if (buildPlan.classification.needsStrategyReview) {
    cmds.push(`npm run hartos:strategy-review -- --request="${buildPlan.request}"`);
  }
  if (buildPlan.classification.needsCtoReview) {
    cmds.push(`npm run hartos:cto-review -- --request="${buildPlan.request}"`);
  }
  cmds.push(`npm run hartos:build-plan -- --request="${buildPlan.request}"`);
  if (buildPlan.missingCapabilities.length > 0) {
    cmds.push("npm run beezulbub:capability-list");
  }
  cmds.push("npm run hartos:handover");
  return cmds;
}

function buildSidecar(result: OrchestratorResult): OrchestratorReportSidecar {
  const c = result.classification;
  const recommendedNextAction =
    result.strategy?.recommendedNextAction ??
    (result.buildPlan ? "Review the build plan and address phase 1." : "Run hartos:build-plan.");

  return {
    request: result.request,
    generatedAt: result.generatedAt,
    classification: c.classification,
    domain: c.domain,
    riskLevel: c.riskLevel,
    buildTarget: c.buildTarget,
    strategyVerdict: result.strategy ? result.strategy.verdict : null,
    technicalVerdict: result.cto ? result.cto.technicalVerdict : null,
    usableCapabilities: result.gap ? result.gap.usableCapabilities : [],
    missingCapabilities: result.gap ? result.gap.missingCapabilities : [],
    recommendedBeezulbubActions: result.buildPlan ? result.buildPlan.recommendedBeezulbubActions : [],
    recommendedFactoryActions: result.buildPlan ? result.buildPlan.recommendedFactoryActions : [],
    risks: result.buildPlan ? result.buildPlan.risks : [],
    doNotBuild: result.buildPlan ? result.buildPlan.doNotBuild : [],
    recommendedNextAction,
    commandsToRunNext: commandsToRunNext(result.buildPlan),
  };
}

export async function runOrchestrator(
  request: string,
  options: OrchestratorOptions = {}
): Promise<OrchestratorResult> {
  const cwd = options.cwd ?? process.cwd();
  const shouldWrite = options.writeReport !== false;
  const reportsDir = options.reportsDir
    ? path.resolve(cwd, options.reportsDir)
    : path.resolve(cwd, DEFAULT_REPORTS_DIR);

  // 1–2. Classify
  const classification = classifyRequest(request);

  // 5. Capability gap (computed early so strategy & CTO can consume it)
  const gap = await detectCapabilityGaps(request, {
    registryPath: options.registryPath,
    ledgerPath: options.ledgerPath,
    cwd,
  });

  // 3. Strategy review (if needed)
  const strategy = classification.needsStrategyReview
    ? reviewStrategy(request, { missingFoundationCapabilities: gap.missingCapabilities })
    : null;

  // 4. CTO review (only when relevant)
  const cto = classification.needsCtoReview
    ? await reviewCto(request, {
        registryPath: options.registryPath,
        ledgerPath: options.ledgerPath,
        packsDir: options.packsDir,
        cwd,
      })
    : null;

  // 6. Build plan (reuse already-computed pieces)
  const buildPlan = await generateBuildPlan(request, {
    registryPath: options.registryPath,
    ledgerPath: options.ledgerPath,
    packsDir: options.packsDir,
    cwd,
    classification,
    strategy,
    cto,
    gap,
  });

  const result: OrchestratorResult = {
    request,
    classification,
    strategy,
    cto,
    gap,
    buildPlan,
    generatedAt: new Date().toISOString(),
  };

  // 7. Write report + sidecar
  if (shouldWrite) {
    const content = formatOrchestratorReport(result);
    const reportPath = await writeReport(reportsDir, "orchestrator", content);
    await writeSidecar(reportsDir, buildSidecar(result));
    result.reportPath = reportPath;
  }

  return result;
}
