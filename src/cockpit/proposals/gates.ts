/**
 * src/cockpit/proposals/gates.ts
 *
 * Phase 14A — safety gates for the proposal layer.
 *
 *   ALLOW_COCKPIT_ACTION_PROPOSALS=true   → proposals advance to pending_approval.
 *   ALLOW_COCKPIT_ACTION_EXECUTION        → UNSUPPORTED. Execution always fails
 *                                           closed, regardless of env.
 *
 * Read-only Phase 13 functionality NEVER depends on these gates. Drafts are
 * always safe to generate (they are non-executable); the proposals gate only
 * controls whether a draft is surfaced as "pending_approval".
 */

export type GateEnv = Record<string, string | undefined>;

export const PROPOSALS_GATE = "ALLOW_COCKPIT_ACTION_PROPOSALS";
export const EXECUTION_GATE = "ALLOW_COCKPIT_ACTION_EXECUTION";

/** True when proposal drafts may be surfaced for approval. */
export function proposalsAllowed(env: GateEnv = process.env): boolean {
  return env[PROPOSALS_GATE] === "true";
}

/**
 * ALWAYS false. Execution is unsupported in Phase 14A. Even if the env var is
 * set, this returns false — the gate is hard-capped closed by design.
 */
export function executionAllowed(_env: GateEnv = process.env): false {
  return false;
}

export class ActionExecutionDisabledError extends Error {
  constructor(message = "Action execution is disabled. Phase 14A is proposal + approval only — no real execution exists.") {
    super(message);
    this.name = "ActionExecutionDisabledError";
  }
}

/**
 * The ONLY "execution" entry point — it ALWAYS fails closed with a safe message.
 * There is deliberately no code path that performs a real action.
 */
export function executeProposal(): never {
  throw new ActionExecutionDisabledError();
}

/** A safe, human-readable reason string for why execution is disabled. */
export function executionDisabledReason(env: GateEnv = process.env): string {
  const flag = env[EXECUTION_GATE];
  const note = flag === "true"
    ? `${EXECUTION_GATE}=true is ignored — execution remains unsupported in Phase 14A.`
    : `${EXECUTION_GATE} is not enabled (and is unsupported in Phase 14A).`;
  return `Execution is disabled and fails closed. ${note}`;
}
