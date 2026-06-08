/**
 * src/execution/execution-adapter.ts — Phase 3: the first safe execution framework.
 *
 * Execution NEVER happens in the read-only Worker/Edge Function — only a Node host runs
 * an adapter, and ONLY through `runExecutionAdapter`, which:
 *   1. writes an audit "attempt" FIRST (audit-before-execute, by construction),
 *   2. calls the Phase 2.5 fail-closed precondition (`checkExecutionPrecondition`) —
 *      approved_for_execution + non-expired + capability token + audit + the PER-ACTION
 *      allowlist flag,
 *   3. executes ONLY if every check passes; otherwise records a refusal and returns it.
 *
 * Fail-closed by construction: the per-action flag is OFF by default (its env var absent),
 * and a global kill-switch (`HARTOS_EXECUTION_KILL_SWITCH=on`) overrides ANY per-action
 * flag. So nothing executes until it is deliberately, narrowly enabled. ACTION_EXECUTION
 * stays globally "disabled"; this is the single per-action carve-out Phase 3 introduces.
 */

import { checkExecutionPrecondition, type PreconditionResult } from "../doctrine/execution-gate.js";
import type { ProposalQueueStatus } from "../cockpit/proposals/proposal-types.js";

/** Global kill-switch — when set, NO action may execute, regardless of per-action flags. */
export const KILL_SWITCH_ENV = "HARTOS_EXECUTION_KILL_SWITCH";

export interface ExecutionOutcome {
  ran: boolean;
  /** True when the effect is reversible / re-runnable without harm. */
  reversible: boolean;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  summary: string;
}

/** A single, reversible, allowlisted action. `dryRun`/`execute` share one deps object `D`. */
export interface ExecutionAdapter<D = unknown> {
  id: string;
  /** The env var that must equal "true" to allow this ONE action. Default-absent ⇒ OFF. */
  allowlistFlag: string;
  /** Describe what WOULD happen — no writes. */
  dryRun(deps: D): Promise<ExecutionOutcome>;
  /** Execute for real. MUST be idempotent + reversible. */
  execute(deps: D): Promise<ExecutionOutcome>;
}

/** The authorization context for one execution attempt (built by the Node executor). */
export interface ExecutionContext {
  proposalId: string;
  status: ProposalQueueStatus;
  expiresAt: string | null;
  now: string;
  /** The executor was invoked with valid authorization (capability token / elevated cred). */
  hasCapabilityToken: boolean;
  /** Per-action allowlist flags + the kill-switch, read by name (never values logged). */
  env: Record<string, string | undefined>;
}

export interface AdapterRunDeps<D> {
  adapterDeps: D;
  /** Append an immutable audit entry. Called for the attempt, the refusal, and the result. */
  writeAudit: (event: string, detail: string) => Promise<void>;
}

export interface AdapterRunResult {
  adapterId: string;
  precondition: PreconditionResult;
  executed: boolean;
  outcome: ExecutionOutcome | null;
}

function killSwitchOn(env: Record<string, string | undefined>): boolean {
  return (env[KILL_SWITCH_ENV] ?? "").trim().toLowerCase() === "on";
}

/** True only when the global kill-switch is OFF *and* this action's flag is exactly "true". */
export function isActionAllowlisted(adapter: ExecutionAdapter, env: Record<string, string | undefined>): boolean {
  if (killSwitchOn(env)) return false;
  return env[adapter.allowlistFlag] === "true";
}

/**
 * The ONLY way to run an adapter. Audits the attempt, enforces the fail-closed gate, and
 * executes only if every condition holds. Never throws past the audit of an error.
 */
export async function runExecutionAdapter<D>(
  adapter: ExecutionAdapter<D>,
  ctx: ExecutionContext,
  deps: AdapterRunDeps<D>,
): Promise<AdapterRunResult> {
  // 1) Audit the attempt FIRST — so the precondition's audit requirement holds by
  //    construction, and even a refusal leaves a trail.
  await deps.writeAudit("execution_attempt", `${adapter.id} on proposal ${ctx.proposalId}`);

  // 2) Fail-closed gate (Phase 2.5) + the per-action allowlist (with the kill-switch).
  const pre = checkExecutionPrecondition({
    status: ctx.status,
    expiresAt: ctx.expiresAt,
    now: ctx.now,
    hasCapabilityToken: ctx.hasCapabilityToken,
    auditEntryWritten: true,
    actionAllowlisted: isActionAllowlisted(adapter, ctx.env),
  });
  if (!pre.allowed) {
    await deps.writeAudit("execution_refused", pre.denials.join("; "));
    return { adapterId: adapter.id, precondition: pre, executed: false, outcome: null };
  }

  // 3) Execute — and audit the outcome (or the error, then re-deny rather than crash open).
  try {
    const outcome = await adapter.execute(deps.adapterDeps);
    await deps.writeAudit(outcome.ran ? "executed" : "execution_noop", outcome.summary);
    return { adapterId: adapter.id, precondition: pre, executed: outcome.ran, outcome };
  } catch (err) {
    await deps.writeAudit("execution_failed", err instanceof Error ? err.message : "unknown error");
    return { adapterId: adapter.id, precondition: pre, executed: false, outcome: null };
  }
}
