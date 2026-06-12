/**
 * src/execution/inverse-command.ts — P4: derive the INVERSE mutation that undoes an executed one.
 *
 * Distinct from the INFRA rollback subsystem (src/launch/rollback-execution.ts + the deploy-level
 * "rollback plan"). This is the PROPOSAL-MUTATION rollback: a reversible external mutation is undone
 * by running the SAME forward adapter in the opposite direction, so rollback rides the existing
 * gated dispatch path — no parallel write authority.
 *
 * PURE. Returns the inverse command ONLY when the undo is itself safe (the original ran + was
 * reversible, and the reverse is itself an approved transition); otherwise reports why not. The
 * rollback-gate + the adapter's own read-before-write still decide whether the inverse actually runs.
 */

import type { MutationCommand } from "./execution-dispatch.js";
import type { ExecutionOutcome } from "./execution-adapter.js";
import { isApprovedTransition } from "./adapters/clickup-move-status.js";

export type InverseResult =
  | { reversible: true; command: MutationCommand }
  | { reversible: false; reason: string };

function statusOf(snapshot: Record<string, unknown>): string {
  const s = snapshot.status;
  return typeof s === "string" ? s : "";
}

/**
 * The command that undoes `command` given its `outcome`, or a reason it cannot be auto-inverted.
 * Today only the reversible external mutation (clickup-move-status) has an automatic inverse: move
 * the card from where it now is (outcome.after) back to where it was (outcome.before) — but ONLY if
 * that reverse is itself an approved transition (HartOS never invents a transition, not even to undo).
 */
export function inverseCommandFor(command: MutationCommand, outcome: ExecutionOutcome): InverseResult {
  if (!outcome.ran) {
    return { reversible: false, reason: "original mutation did not run — nothing to undo" };
  }
  if (!outcome.reversible) {
    return { reversible: false, reason: "original outcome was marked irreversible" };
  }

  if (command.adapterId === "clickup-move-status") {
    const before = statusOf(outcome.before);
    const after = statusOf(outcome.after);
    if (!before || !after) {
      return { reversible: false, reason: "missing before/after status — cannot derive the inverse move" };
    }
    if (!isApprovedTransition(after, before)) {
      return { reversible: false, reason: `reverse transition "${after}" → "${before}" is not approved — undo would invent a transition` };
    }
    return {
      reversible: true,
      command: {
        adapterId: "clickup-move-status",
        proposal: command.proposal,
        target: { cardId: command.target.cardId, cardName: command.target.cardName, fromStatus: after, toStatus: before },
        store: command.store,
      },
    };
  }

  return { reversible: false, reason: `adapter "${command.adapterId}" has no automatic inverse yet` };
}
