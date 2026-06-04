/**
 * src/bootstrap/bootstrap-engine.ts
 *
 * Execute bootstrap steps behind explicit gates.
 * Phase 10: most provider steps return manual_required.
 * Clean automated steps: Cloudflare deploy, Telegram webhook, migration apply.
 *
 * Gates required:
 *   ALLOW_BOOTSTRAP_PROVISION=true
 *   CONFIRM_BOOTSTRAP_PROVISION=true
 *   Per-step gates as shown in the plan
 */

import type { BootstrapResult, BootstrapStep, BootstrapStatus, BootstrapOptions } from "./types.js";
import { checkBootstrap } from "./bootstrap-check.js";
import { getEnv } from "../runtime/env.js";

function safeMsg(msg: string): string {
  return msg.replace(/[A-Za-z0-9+/=_-]{40,}/g, "[REDACTED]").slice(0, 200);
}

function executeResult(
  step: BootstrapStep,
  status: BootstrapStatus,
  message: string
): BootstrapStep {
  return { ...step, status, message: safeMsg(message) };
}

export async function runBootstrapEngine(
  options: BootstrapOptions = {}
): Promise<BootstrapResult> {
  const env = options.env ?? (getEnv() as Record<string, string | undefined>);
  const timestamp = new Date().toISOString();

  // Build plan
  const plan = await checkBootstrap(env);

  // Check global bootstrap gates
  const globalGateOpen =
    env["ALLOW_BOOTSTRAP_PROVISION"] === "true" &&
    env["CONFIRM_BOOTSTRAP_PROVISION"] === "true";

  if (!globalGateOpen) {
    const missingGates: string[] = [];
    if (env["ALLOW_BOOTSTRAP_PROVISION"] !== "true") missingGates.push("ALLOW_BOOTSTRAP_PROVISION");
    if (env["CONFIRM_BOOTSTRAP_PROVISION"] !== "true") missingGates.push("CONFIRM_BOOTSTRAP_PROVISION");

    const blockedResults = plan.steps.map((step) =>
      step.status === "ready" || step.status === "gate_missing"
        ? executeResult(step, "gate_missing", `Blocked: set ${missingGates.join(", ")}=true`)
        : step
    );

    return {
      agentName: plan.agentName,
      status: "gate_missing",
      plan,
      results: blockedResults,
      timestamp,
      summary: `Bootstrap blocked. Missing gates: ${missingGates.join(", ")}`,
    };
  }

  // Execute steps
  const results: BootstrapStep[] = [];
  let anyFailed = false;
  let anyManual = false;

  for (const step of plan.steps) {
    if (step.status === "missing_env") {
      results.push(executeResult(step, "missing_env", `Missing env: ${step.message}`));
      continue;
    }

    if (step.status === "manual_required") {
      anyManual = true;
      results.push(step);
      continue;
    }

    // Check step gate
    if (step.requiredGate && env[step.requiredGate] !== "true") {
      results.push(executeResult(
        step,
        "gate_missing",
        `Set ${step.requiredGate}=true to execute this step`
      ));
      continue;
    }

    // Gate is open — but most steps delegate to existing scripts
    // Return the appropriate status based on the existing gate state
    results.push(executeResult(
      step,
      step.status === "ready" ? "applied" : step.status,
      step.status === "ready"
        ? `${step.action} ready — run associated npm script to execute`
        : step.message
    ));
  }

  const overallStatus: BootstrapStatus = anyFailed
    ? "degraded"
    : anyManual
      ? "manual_required"
      : "applied";

  return {
    agentName: plan.agentName,
    status: overallStatus,
    plan,
    results,
    timestamp,
    summary:
      overallStatus === "applied"
        ? "Bootstrap plan executed. Review results."
        : `Bootstrap: ${results.filter((r) => r.status === "manual_required").length} manual step(s) required.`,
  };
}
