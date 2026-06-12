/**
 * src/execution/run-fitness-mutation.ts — P5: the gated fitness-mutation executor.
 *
 * The Node host enforces the Phase 2.5 fail-closed gate (via `runExecutionAdapter`) and, only when
 * it passes, applies the deterministic FitnessAdjustment through the injected store. `dryRun:true`
 * is the read-only preview (what would change; no write); the real path reads the day, refuses if
 * there is no state, no-ops if this band's adjustment already landed, else applies it once.
 *
 * The decision (band × load → adjustment) is made UPSTREAM by deriveFitnessAdjustment — never an
 * LLM, never here. Proposal-level authorization (approved_for_execution + capability + audit + the
 * per-action allowlist flag HARTOS_ALLOW_FITNESS_ADJUST, default OFF) is the only way it may run.
 *
 * Node/Edge ONLY — the live store carries the fitness service-role capability; never the Worker.
 */

import { runExecutionAdapter, type ExecutionContext, type AdapterRunResult } from "./execution-adapter.js";
import { fitnessMutationAdapter, type FitnessMutationStore } from "./adapters/fitness-mutation.js";
import type { FitnessAdjustment } from "../fitness/fitness-adjustment-rules.js";
import { makeIdempotencyKey } from "../lib/idempotency-key.js";

export interface FitnessMutationProposal {
  id: string;
  status: ExecutionContext["status"];
  expiresAt: string | null;
}

export interface FitnessMutationTarget {
  stateDate: string;
  recoveryBand: "green" | "amber" | "red";
  adjustment: FitnessAdjustment;
}

/**
 * Deterministic key from TRUSTED fields only (state_date + band + the fixed mutation type) — never
 * LLM text. Matches the fitness-side idempotency contract (state_date + recovery_band + type).
 */
export function fitnessMutationIdempotencyKey(stateDate: string, recoveryBand: string): string {
  return makeIdempotencyKey([stateDate, "fitness-adjust", recoveryBand]);
}

export async function runFitnessMutation(
  proposal: FitnessMutationProposal,
  target: FitnessMutationTarget,
  env: Record<string, string | undefined>,
  opts: { now?: string; dryRun?: boolean; store: FitnessMutationStore; hasCapabilityToken?: boolean },
): Promise<AdapterRunResult> {
  const now = opts.now ?? new Date().toISOString();
  const ctx: ExecutionContext = {
    proposalId: proposal.id,
    status: proposal.status,
    expiresAt: proposal.expiresAt,
    now,
    // Write capability = the fitness service-role reach (Hart Personal Core), held by the live store.
    hasCapabilityToken: opts.hasCapabilityToken ?? Boolean(env.HARTOS_SUPABASE_DB_URL),
    env,
  };
  const adapterDeps = { store: opts.store, stateDate: target.stateDate, recoveryBand: target.recoveryBand, adjustment: target.adjustment };
  const writeAudit = async (event: string, detail: string): Promise<void> => {
    console.log(`[exec-audit] ${event}: ${detail}`);
  };

  if (opts.dryRun) {
    const outcome = await fitnessMutationAdapter.dryRun(adapterDeps);
    await writeAudit("execution_dry_run", outcome.summary);
    return { adapterId: fitnessMutationAdapter.id, precondition: { allowed: true, denials: [] }, executed: false, outcome };
  }

  return runExecutionAdapter(fitnessMutationAdapter, ctx, { adapterDeps, writeAudit });
}
