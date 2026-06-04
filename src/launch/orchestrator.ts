/**
 * src/launch/orchestrator.ts
 *
 * Staging launch orchestrator — Phase 8.
 *
 * Coordinates the full staging launch sequence:
 *   1. Readiness check
 *   2. Provision plan
 *   3. Provider status verify
 *   4. Provision auto (staging, gated)
 *   5. Deployment readiness check
 *   6. Staging smoke
 *   7. Launch report
 *   8. Rollback plan
 *
 * Respects all existing Phase 5-7 gates.
 * Required gates for mutations: ALLOW_AUTO_PROVISION=true, CONFIRM_STAGING_PROVISION=true.
 * Each provider also requires its own gate (e.g. ALLOW_GITHUB_PROVISION, ALLOW_CLOUDFLARE_DEPLOY).
 * If gates are missing, steps are skipped safely — never crashes, never mutates without consent.
 * Never mutates infrastructure without explicit gates.
 * Returns a complete LaunchReport regardless of gate state.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { getEnv, optionalEnv, checkProviderStatus } from "../runtime/env.js";
import {
  buildProvisionPlan,
  getDefaultAdapters,
  buildContext,
} from "../provisioning/plan.js";
import { runProvisionEngine } from "../provisioning/engine.js";
import {
  checkAutoProvisionGate,
  checkEnvironmentGate,
} from "../provisioning/gates.js";
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
import { buildStatusMatrix, formatStatusMatrix } from "../provisioning/status-matrix.js";
import { loadLedger } from "../provisioning/ledger.js";
import { buildRollbackPlan } from "../provisioning/rollback.js";
import type { ProviderAdapter } from "../provisioning/types.js";
import { checkLaunchReadiness } from "./readiness.js";
import { deriveLaunchStatus, buildNextAction, writeLaunchReport } from "./report.js";
import type {
  LaunchReport,
  LaunchStep,
  StagingLaunchOptions,
} from "./types.js";

const AGENT_NAME = "test-agent";
const PROVIDER_ORDER: ProviderAdapter["provider"][] = [
  "github",
  "openai",
  "supabase",
  "cloudflare",
  "telegram",
  "trigger",
];

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

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function runStagingLaunch(
  options: StagingLaunchOptions = {}
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
    environment: "staging" as const,
    env,
  };

  // ── Step 1: Readiness check ──────────────────────────────────────────────
  const readiness = await checkLaunchReadiness(env, root);
  steps.push(
    makeStep(
      "readiness",
      "Pre-launch readiness",
      "local",
      readiness.ready ? "success" : "degraded",
      readiness.ready
        ? "Readiness check passed"
        : `Readiness issues: ${readiness.warnings.slice(0, 3).join("; ")}`,
      { missingGates: readiness.missingGates }
    )
  );

  // ── Step 2: Provision plan ───────────────────────────────────────────────
  let adapters: ProviderAdapter[];
  try {
    adapters = options.adapters ?? (await getDefaultAdapters());
    // Sort adapters in provider launch order
    adapters = [...adapters].sort((a, b) => {
      const ai = PROVIDER_ORDER.indexOf(a.provider);
      const bi = PROVIDER_ORDER.indexOf(b.provider);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    const plan = await buildProvisionPlan(context, adapters);
    steps.push(
      makeStep(
        "provision:plan",
        "Provision plan",
        "orchestrator",
        "success",
        `Plan: ${plan.totalSteps} steps (${plan.mutatingSteps} mutating, ${plan.readOnlySteps} read-only)`
      )
    );
  } catch (err) {
    steps.push(
      makeStep(
        "provision:plan",
        "Provision plan",
        "orchestrator",
        "failed",
        `Plan failed: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`
      )
    );
    adapters = [];
  }

  // ── Step 3: Provider status verify ──────────────────────────────────────
  if (adapters.length > 0) {
    try {
      const matrix = await buildStatusMatrix(adapters, context);
      const configured = matrix.configuredCount;
      const total = matrix.providers.length;
      steps.push(
        makeStep(
          "provision:verify",
          "Provider status",
          "orchestrator",
          configured === total ? "success" : "degraded",
          `${configured}/${total} providers configured`
        )
      );
    } catch (err) {
      steps.push(
        makeStep("provision:verify", "Provider status", "orchestrator", "failed",
          `Verify failed: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`)
      );
    }
  }

  // ── Step 4: Provision auto (staging, gated) ──────────────────────────────
  const globalGate = checkAutoProvisionGate(env);
  const envGate = checkEnvironmentGate(env, "staging");

  if (!globalGate.allowed || !envGate.allowed) {
    const missingGates = [
      ...globalGate.missingGates,
      ...envGate.missingGates,
    ];
    steps.push(
      makeStep(
        "provision:auto",
        "Provision auto (staging)",
        "orchestrator",
        "gate_missing",
        `Gates required: ${missingGates.join(", ")}`,
        { missingGates, nextAction: `Set ${missingGates.join(", ")}=true to run auto-provision` }
      )
    );
  } else if (adapters.length > 0) {
    try {
      const plan = await buildProvisionPlan(context, adapters);
      const result = await runProvisionEngine(plan, adapters, context);
      const formatted = formatProvisionResult(result);

      // Write provision report
      const reportFilename = makeReportFilename("provision-report", "staging");
      const pPath = path.join(provisionReportsDir, reportFilename);
      try {
        await writeProvisionReport(provisionReportsDir, reportFilename, formatted);
        provisionReportPath = pPath;
      } catch {
        // Non-fatal
      }

      // Write ledger
      try {
        const entries = buildLedgerEntries(result, "staging");
        const ledger = await appendToLedger(provisionReportsDir, agentName, entries);
        assertLedgerNoSecrets(ledger);
      } catch {
        // Non-fatal
      }

      const manualCount = result.results.filter((r) => r.status === "manual_required").length;
      const failedCount = result.failedCount;
      const appliedCount = result.appliedCount;

      let status: LaunchStep["status"] = "success";
      if (failedCount > 0) status = "failed";
      else if (manualCount > 0) status = "manual_required";

      steps.push(
        makeStep(
          "provision:auto",
          "Provision auto (staging)",
          "orchestrator",
          status,
          `Applied: ${appliedCount}  Manual: ${manualCount}  Failed: ${failedCount}  Gate missing: ${result.gateMissingCount}`,
          {
            manualRequired: manualCount > 0,
            nextAction: manualCount > 0
              ? `Complete ${manualCount} manual step(s) via CLI/dashboard`
              : undefined,
          }
        )
      );

      // Add per-provider steps for manual_required items
      for (const r of result.results.filter((r) => r.status === "manual_required")) {
        steps.push(
          makeStep(
            `provision:${r.step.provider}:${r.step.action}`,
            `${r.step.provider}: ${r.step.action}`,
            r.step.provider,
            "manual_required",
            safeMsg(r.message),
            { manualRequired: true, nextAction: r.step.safeSummary }
          )
        );
      }
    } catch (err) {
      steps.push(
        makeStep("provision:auto", "Provision auto (staging)", "orchestrator", "failed",
          `Auto provision error: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`)
      );
    }
  }

  // ── Step 5: Deployment check ─────────────────────────────────────────────
  const workerUrl = optionalEnv(env, "CLOUDFLARE_WORKER_URL") ??
    optionalEnv(env, "STAGING_CLOUDFLARE_WORKER_URL");

  if (!workerUrl) {
    steps.push(
      makeStep("deployment:check", "Deployment readiness", "cloudflare", "degraded",
        "CLOUDFLARE_WORKER_URL not set — health check skipped",
        { nextAction: "Deploy Worker and set CLOUDFLARE_WORKER_URL" })
    );
  } else {
    try {
      const res = await fetch(`${workerUrl.replace(/\/$/, "")}/health`);
      steps.push(
        makeStep("deployment:check", "Deployment readiness", "cloudflare",
          res.ok ? "success" : "failed",
          `Worker health: ${res.ok ? "ok" : `HTTP ${res.status}`}`)
      );
    } catch {
      steps.push(
        makeStep("deployment:check", "Deployment readiness", "cloudflare", "degraded",
          "Worker health check failed — Worker not deployed or unreachable",
          { nextAction: "Deploy Worker: ALLOW_CLOUDFLARE_DEPLOY=true npm run deploy:staging" })
      );
    }
  }

  // ── Step 6: Staging smoke ────────────────────────────────────────────────
  const providerStatuses = checkProviderStatus(env as Record<string, string>);
  const configuredProviders = providerStatuses.filter((p) => p.configured).length;
  const totalProviders = providerStatuses.length;

  if (configuredProviders === 0) {
    smokeResult = "skipped";
    steps.push(
      makeStep("smoke:staging", "Staging smoke", "local", "skipped",
        "No providers configured — smoke skipped",
        { nextAction: "Configure providers, then re-run launch:staging" })
    );
  } else {
    // Run a basic smoke check: provider status + env check
    const allProvidersOk = providerStatuses.every((p) => p.configured);
    smokeResult = workerUrl ? (allProvidersOk ? "passed" : "failed") : "skipped";
    steps.push(
      makeStep("smoke:staging", "Staging smoke", "local",
        smokeResult === "passed" ? "success" : smokeResult === "skipped" ? "skipped" : "degraded",
        `${configuredProviders}/${totalProviders} providers configured. Worker: ${workerUrl ? "set" : "not set"}`,
        { nextAction: smokeResult !== "passed" ? "Configure all providers and deploy Worker" : "" })
    );
  }

  // ── Step 7: Write rollback plan ──────────────────────────────────────────
  try {
    const ledger = await loadLedger(provisionReportsDir);
    if (ledger) {
      const rollback = buildRollbackPlan(ledger, "staging");
      const rollbackFilename = `rollback-plan-staging-${timestamp.replace(/[:.]/g, "-")}.md`;
      const rbPath = path.join(reportsDir, rollbackFilename);
      const { writeFile: wf } = await import("node:fs/promises");
      await wf(rbPath, rollback.formatted, "utf8");
      rollbackPlanPath = rbPath;
    }
  } catch {
    // Non-fatal
  }

  // ── Derive overall launch status ────────────────────────────────────────
  const allMissingGates = steps.flatMap((s) => s.missingGates);
  const manualRequiredSteps = steps
    .filter((s) => s.manualRequired)
    .map((s) => s.id);

  const missingGlobalGates = !globalGate.allowed || !envGate.allowed;
  const launchStatus = deriveLaunchStatus(steps, smokeResult, missingGlobalGates);

  const safeSummary = buildSafeSummary(launchStatus, steps, smokeResult);

  const report: LaunchReport = {
    agentName,
    environment: "staging",
    launchStatus,
    timestamp,
    steps,
    missingGates: [...new Set(allMissingGates)],
    manualRequiredSteps,
    smokeResult,
    provisionReportPath,
    rollbackPlanPath,
    nextAction: buildNextAction({
      launchStatus,
      missingGates: [...new Set(allMissingGates)],
      manualRequiredSteps,
    } as LaunchReport),
    safeSummary,
  };

  return report;
}

function buildSafeSummary(
  status: LaunchReport["launchStatus"],
  steps: LaunchStep[],
  smoke: LaunchReport["smokeResult"]
): string {
  const ok = steps.filter((s) => s.status === "success").length;
  const manual = steps.filter((s) => s.status === "manual_required").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  const gating = steps.filter((s) => s.status === "gate_missing").length;

  return [
    `Launch status: ${status}.`,
    `Steps: ${ok} ok, ${manual} manual, ${failed} failed, ${gating} gated.`,
    `Smoke: ${smoke}.`,
  ].join(" ");
}
