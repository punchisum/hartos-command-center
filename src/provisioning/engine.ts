/**
 * src/provisioning/engine.ts
 *
 * Provision engine: processes a ProvisionPlan against a set of adapters.
 * Respects gates, records results, never mutates without explicit permission.
 *
 * Phase 6: real apply() is not_implemented for all provider adapters.
 * Phase 7: provider adapters will implement real apply().
 */

import type {
  ProvisionPlan,
  ProvisionResult,
  ProvisionStepResult,
  ProvisionContext,
  ProviderAdapter,
} from "./types.js";
import { checkStepGate } from "./gates.js";

/**
 * Run the provisioning engine against a pre-built plan.
 * - Read-only steps are passed to verify().
 * - Mutating steps require explicit gate(s).
 * - If a gate is missing, the step is skipped with status=gate_missing.
 * - If adapter has no apply(), step is skipped with status=not_implemented.
 */
export async function runProvisionEngine(
  plan: ProvisionPlan,
  adapters: ProviderAdapter[],
  context: ProvisionContext
): Promise<ProvisionResult> {
  const results: ProvisionStepResult[] = [];
  const adapterMap = new Map(adapters.map((a) => [a.provider, a]));

  for (const step of plan.steps) {
    const now = new Date().toISOString();

    // Gate check
    const gate = checkStepGate(step, context.env);
    if (!gate.allowed) {
      results.push({
        step: { ...step, status: "gate_missing" },
        status: "gate_missing",
        message: gate.message,
        timestamp: now,
      });
      continue;
    }

    const adapter = adapterMap.get(step.provider);

    // Read-only: run verify instead of apply
    if (!step.mutation) {
      if (adapter) {
        try {
          const vr = await adapter.verify(context);
          results.push({
            step: { ...step, status: "verified" },
            status: "verified",
            message: vr.safeSummary,
            timestamp: now,
          });
        } catch (err) {
          results.push({
            step: { ...step, status: "failed" },
            status: "failed",
            message: err instanceof Error ? err.message : "Verification error",
            timestamp: now,
          });
        }
      } else {
        results.push({
          step: { ...step, status: "skipped" },
          status: "skipped",
          message: `No adapter found for provider: ${step.provider}`,
          timestamp: now,
        });
      }
      continue;
    }

    // Mutating: check for apply() implementation
    if (!adapter || !adapter.apply) {
      results.push({
        step: { ...step, status: "not_implemented" },
        status: "not_implemented",
        message:
          `${step.provider}:${step.action} has no apply() in Phase 6. ` +
          `Real provider adapters will be implemented in Phase 7.`,
        timestamp: now,
      });
      continue;
    }

    // Apply (only reached if gate is open AND adapter has apply())
    try {
      const result = await adapter.apply(step, context);
      results.push(result);
    } catch (err) {
      results.push({
        step: { ...step, status: "failed" },
        status: "failed",
        message: err instanceof Error ? err.message : "Apply error",
        timestamp: now,
      });
    }
  }

  // Phase 7A: "already_exists" and "created" are both success outcomes.
  const counts = {
    skipped: results.filter((r) => r.status === "skipped").length,
    applied: results.filter(
      (r) => r.status === "applied" || r.status === "created" || r.status === "already_exists"
    ).length,
    verified: results.filter((r) => r.status === "verified").length,
    failed: results.filter((r) => r.status === "failed").length,
    notImplemented: results.filter((r) => r.status === "not_implemented").length,
    gateMissing: results.filter((r) => r.status === "gate_missing").length,
  };

  return {
    plan,
    results,
    timestamp: new Date().toISOString(),
    success: counts.failed === 0,
    skippedCount: counts.skipped,
    appliedCount: counts.applied,
    failedCount: counts.failed,
    notImplementedCount: counts.notImplemented,
    gateMissingCount: counts.gateMissing,
  };
}
