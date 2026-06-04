/**
 * src/launch/production-launch.ts
 *
 * Production launch orchestrator — Phase 9.
 *
 * Similar to staging orchestrator but:
 *   - Requires staging proof (recent staging-launch-*.json with success/partial)
 *   - Uses CONFIRM_PRODUCTION_DEPLOY instead of CONFIRM_STAGING_PROVISION
 *   - Uses production environment for all adapters
 *   - Generates production report + comparison + rollback plan
 *
 * Never mutates without CONFIRM_PRODUCTION_DEPLOY=true + ALLOW_PRODUCTION_PROMOTION=true.
 */

import path from "node:path";
import { mkdir } from "node:fs/promises";
import { getEnv, optionalEnv } from "../runtime/env.js";
import {
  buildProvisionPlan,
  getDefaultAdapters,
} from "../provisioning/plan.js";
import { runProvisionEngine } from "../provisioning/engine.js";
import { checkAutoProvisionGate } from "../provisioning/gates.js";
import {
  formatProvisionResult,
  writeReport as writeProvisionReport,
  makeReportFilename,
} from "../provisioning/report.js";
import {
  buildLedgerEntries,
  appendToLedger,
  assertLedgerNoSecrets,
} from "../provisioning/ledger.js";
import { buildStatusMatrix } from "../provisioning/status-matrix.js";
import { buildRollbackPlan } from "../provisioning/rollback.js";
import { loadLedger } from "../provisioning/ledger.js";
import type { ProviderAdapter } from "../provisioning/types.js";
import { checkProductionPromotionGates } from "./promotion.js";
import { compareReleases, formatReleaseComparison } from "./release-compare.js";
import {
  formatLaunchReport,
  writeLaunchReport,
  buildNextAction,
  deriveLaunchStatus,
  assertNoSecretsInReport,
} from "./report.js";
import type {
  LaunchReport,
  LaunchStep,
  ProductionLaunchOptions,
} from "./types.js";
import { writeFile } from "node:fs/promises";

const AGENT_NAME = "test-agent";

function safeMsg(msg: string): string {
  return msg.replace(/[A-Za-z0-9+/=_-]{40,}/g, "[REDACTED]").slice(0, 200);
}

function makeStep(
  id: string,
  name: string,
  provider: string,
  status: LaunchStep["status"],
  message: string,
  opts: { missingGates?: string[]; nextAction?: string; manualRequired?: boolean } = {}
): LaunchStep {
  return {
    id,
    name,
    provider,
    status,
    message: safeMsg(message),
    manualRequired: opts.manualRequired ?? false,
    missingGates: opts.missingGates ?? [],
    nextAction: opts.nextAction ?? "",
    timestamp: new Date().toISOString(),
  };
}

export async function runProductionLaunch(
  options: ProductionLaunchOptions = {}
): Promise<LaunchReport> {
  const agentName = options.agentName ?? AGENT_NAME;
  const env = options.env ?? (getEnv() as Record<string, string | undefined>);
  const root = process.cwd();
  const reportsDir = options.reportsDir ?? path.join(root, "launch-reports");
  const provisionReportsDir = path.join(root, "provision-reports");

  await mkdir(reportsDir, { recursive: true });

  const steps: LaunchStep[] = [];
  let smokeResult: LaunchReport["smokeResult"] = "skipped";
  let provisionReportPath: string | null = null;
  let rollbackPlanPath: string | null = null;
  const timestamp = new Date().toISOString();

  const context = {
    agentName,
    environment: "production" as const,
    env,
  };

  // ── Step 1: Promotion gate check ─────────────────────────────────────────
  const gateResult = await checkProductionPromotionGates(env, reportsDir);

  if (!gateResult.allowed) {
    steps.push(
      makeStep(
        "production:gate",
        "Production promotion gate",
        "orchestrator",
        "gate_missing",
        gateResult.blockedReason ?? "Gates not met",
        { missingGates: gateResult.missingGates }
      )
    );

    const launchStatus =
      gateResult.blockedReason?.includes("staging") && !gateResult.stagingProof.found
        ? "blocked_no_staging_proof"
        : gateResult.blockedReason?.includes("staging")
          ? "blocked_staging_not_green"
          : "blocked_missing_gate";

    return buildProductionReport(agentName, launchStatus, steps, smokeResult,
      provisionReportPath, rollbackPlanPath, timestamp, gateResult.missingGates);
  }

  steps.push(
    makeStep(
      "production:gate",
      "Production promotion gate",
      "orchestrator",
      "success",
      `Gates open. Staging: ${gateResult.stagingProof.status} (${gateResult.stagingProof.timestamp?.slice(0, 10) ?? "?"})`
    )
  );

  // ── Step 2: Provision plan ────────────────────────────────────────────────
  let adapters: ProviderAdapter[];
  try {
    adapters = options.adapters ?? (await getDefaultAdapters());
    const plan = await buildProvisionPlan(context, adapters);
    steps.push(makeStep("provision:plan", "Provision plan (production)", "orchestrator", "success",
      `Plan: ${plan.totalSteps} steps (${plan.mutatingSteps} mutating, ${plan.readOnlySteps} read-only)`));
  } catch (err) {
    steps.push(makeStep("provision:plan", "Provision plan (production)", "orchestrator", "failed",
      `Plan failed: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`));
    adapters = [];
  }

  // ── Step 3: Provider status ───────────────────────────────────────────────
  if (adapters.length > 0) {
    try {
      const matrix = await buildStatusMatrix(adapters, context);
      const configured = matrix.configuredCount;
      const total = matrix.providers.length;
      steps.push(makeStep("provision:verify", "Provider status (production)", "orchestrator",
        configured === total ? "success" : "degraded",
        `${configured}/${total} providers configured for production`));
    } catch {
      steps.push(makeStep("provision:verify", "Provider status (production)", "orchestrator",
        "failed", "Provider verify failed"));
    }
  }

  // ── Step 4: Production provision auto ─────────────────────────────────────
  const globalGate = checkAutoProvisionGate(env);
  const prodConfirmed = env["CONFIRM_PRODUCTION_DEPLOY"] === "true";

  if (!globalGate.allowed || !prodConfirmed) {
    const missing = [...globalGate.missingGates, ...(!prodConfirmed ? ["CONFIRM_PRODUCTION_DEPLOY"] : [])];
    steps.push(makeStep("provision:auto", "Provision auto (production)", "orchestrator",
      "gate_missing", `Gates required: ${missing.join(", ")}`,
      { missingGates: missing }));
  } else if (adapters.length > 0) {
    try {
      const plan = await buildProvisionPlan(context, adapters);
      const result = await runProvisionEngine(plan, adapters, context);
      const formatted = formatProvisionResult(result);

      const reportFilename = makeReportFilename("provision-report", "production");
      try {
        await writeProvisionReport(provisionReportsDir, reportFilename, formatted);
        provisionReportPath = path.join(provisionReportsDir, reportFilename);
      } catch { /* non-fatal */ }

      try {
        const entries = buildLedgerEntries(result, "production");
        const ledger = await appendToLedger(provisionReportsDir, agentName, entries);
        assertLedgerNoSecrets(ledger);
      } catch { /* non-fatal */ }

      const manualCount = result.results.filter((r) => r.status === "manual_required").length;
      const failedCount = result.failedCount;
      const appliedCount = result.appliedCount;
      let status: LaunchStep["status"] = "success";
      if (failedCount > 0) status = "failed";
      else if (manualCount > 0) status = "manual_required";

      steps.push(makeStep("provision:auto", "Provision auto (production)", "orchestrator", status,
        `Applied: ${appliedCount}  Manual: ${manualCount}  Failed: ${failedCount}  Gated: ${result.gateMissingCount}`,
        { manualRequired: manualCount > 0 }));

      for (const r of result.results.filter((r) => r.status === "manual_required")) {
        steps.push(makeStep(
          `provision:${r.step.provider}:${r.step.action}`,
          `${r.step.provider}: ${r.step.action}`,
          r.step.provider, "manual_required", safeMsg(r.message),
          { manualRequired: true, nextAction: r.step.safeSummary }));
      }
    } catch (err) {
      steps.push(makeStep("provision:auto", "Provision auto (production)", "orchestrator", "failed",
        `Auto provision error: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`));
    }
  }

  // ── Step 5: Production smoke ──────────────────────────────────────────────
  const workerUrl = optionalEnv(env, "PRODUCTION_CLOUDFLARE_WORKER_URL") ??
    optionalEnv(env, "CLOUDFLARE_WORKER_URL");
  if (workerUrl) {
    try {
      const res = await fetch(`${workerUrl.replace(/\/$/, "")}/health`);
      smokeResult = res.ok ? "passed" : "failed";
      steps.push(makeStep("smoke:production", "Production smoke", "cloudflare",
        res.ok ? "success" : "failed",
        `Worker health: ${res.ok ? "ok" : `HTTP ${res.status}`}`));
    } catch {
      smokeResult = "failed";
      steps.push(makeStep("smoke:production", "Production smoke", "cloudflare", "degraded",
        "Worker health check failed — Worker not deployed or unreachable"));
    }
  } else {
    steps.push(makeStep("smoke:production", "Production smoke", "local", "skipped",
      "PRODUCTION_CLOUDFLARE_WORKER_URL not set — smoke skipped"));
  }

  // ── Step 6: Release comparison ────────────────────────────────────────────
  try {
    const comparison = await compareReleases(reportsDir, "staging-launch-");
    const compFormatted = formatReleaseComparison(comparison);
    assertNoSecretsInReport(compFormatted);
    const compPath = path.join(reportsDir, `release-compare-${timestamp.replace(/[:.]/g, "-")}.md`);
    await writeFile(compPath, compFormatted, "utf8");
    steps.push(makeStep("release:compare", "Release comparison", "orchestrator",
      comparison.changes.length > 0 ? "degraded" : "success",
      comparison.summary));
  } catch { /* non-fatal */ }

  // ── Step 7: Rollback plan ─────────────────────────────────────────────────
  try {
    const ledger = await loadLedger(provisionReportsDir);
    if (ledger) {
      const rollback = buildRollbackPlan(ledger, "production");
      const rbPath = path.join(reportsDir, `rollback-plan-production-${timestamp.replace(/[:.]/g, "-")}.md`);
      await writeFile(rbPath, rollback.formatted, "utf8");
      rollbackPlanPath = rbPath;
    }
  } catch { /* non-fatal */ }

  // ── Derive status ─────────────────────────────────────────────────────────
  const allMissingGates = steps.flatMap((s) => s.missingGates);
  const manualRequiredSteps = steps.filter((s) => s.manualRequired).map((s) => s.id);
  const missingGlobalGates = !globalGate.allowed || !prodConfirmed;
  const launchStatus = deriveLaunchStatus(steps, smokeResult, missingGlobalGates);

  return buildProductionReport(agentName, launchStatus, steps, smokeResult,
    provisionReportPath, rollbackPlanPath, timestamp, [...new Set(allMissingGates)],
    manualRequiredSteps);
}

function buildProductionReport(
  agentName: string,
  launchStatus: LaunchReport["launchStatus"],
  steps: LaunchStep[],
  smokeResult: LaunchReport["smokeResult"],
  provisionReportPath: string | null,
  rollbackPlanPath: string | null,
  timestamp: string,
  missingGates: string[] = [],
  manualRequiredSteps: string[] = []
): LaunchReport {
  const stepCount = steps.filter((s) => s.status === "success").length;
  const manualCount = steps.filter((s) => s.status === "manual_required").length;
  const failedCount = steps.filter((s) => s.status === "failed").length;

  return {
    agentName,
    environment: "staging", // Use staging type, production is the context
    launchStatus,
    timestamp,
    steps,
    missingGates,
    manualRequiredSteps,
    smokeResult,
    provisionReportPath,
    rollbackPlanPath,
    nextAction: buildNextAction({ launchStatus, missingGates, manualRequiredSteps } as LaunchReport),
    safeSummary: `Production launch: ${launchStatus}. Steps: ${stepCount} ok, ${manualCount} manual, ${failedCount} failed. Smoke: ${smokeResult}.`,
  };
}
