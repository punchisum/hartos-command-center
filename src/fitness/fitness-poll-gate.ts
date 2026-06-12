/**
 * src/fitness/fitness-poll-gate.ts — P5: the live-runner fitness-poll gate (PURE).
 *
 * Polling the fitness side (get_pending_mutations → materialise pending_approval proposals) never
 * executes anything, but it must NOT poll an RPC that doesn't exist yet. So the live-runner runs the
 * fitness poll ONLY when it is explicitly enabled AND the fitness identity is configured — default
 * OFF ⇒ a pure no-op (no DB touched). This is SEPARATE from HARTOS_ALLOW_FITNESS_ADJUST, which gates
 * the actual mutation WRITE downstream; enabling the poll only fills the approval queue.
 */

import type { FitnessContext } from "./fitness-mutation-db.js";

export const FITNESS_POLL_FLAG = "HARTOS_FITNESS_POLL";

export interface FitnessPollGate {
  enabled: boolean;
  ctx?: FitnessContext;
  reason: string;
}

/** Decide whether the live-runner should poll the fitness side. Exact "on" match (like ALLOW_EXEC). */
export function fitnessPollGate(env: Record<string, string | undefined>): FitnessPollGate {
  if (env[FITNESS_POLL_FLAG] !== "on") {
    return { enabled: false, reason: `${FITNESS_POLL_FLAG} is not "on" — fitness poll OFF (no-op)` };
  }
  const userId = (env.HARTOS_FITNESS_USER_ID ?? "").trim();
  const agentId = (env.HARTOS_FITNESS_AGENT_ID ?? "").trim();
  if (!userId || !agentId) {
    return { enabled: false, reason: "fitness identity missing (need HARTOS_FITNESS_USER_ID + HARTOS_FITNESS_AGENT_ID)" };
  }
  return { enabled: true, ctx: { userId, agentId }, reason: "fitness poll armed" };
}
