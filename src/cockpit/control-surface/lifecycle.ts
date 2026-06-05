/**
 * src/cockpit/control-surface/lifecycle.ts
 *
 * Phase 18E — the Builder lifecycle stepper. Pure: maps a proposal's REAL status
 * to the 7-step lifecycle (Plan → Approved → Scaffolded → PR Open → Data Applied →
 * Runtime Provisioned → Registered). Never hardcoded — the stepper reads the
 * proposal status + its audit events so a new agent's progress renders honestly.
 */

import type { ProposalQueueStatus } from "../proposals/proposal-types.js";

export type StepState = "done" | "now" | "pending";

export interface LifecycleStep {
  key: string;
  label: string;
  state: StepState;
}

/** The canonical 7 stages, in order. */
export const LIFECYCLE_STAGES = [
  { key: "plan", label: "Plan" },
  { key: "approved", label: "Approved" },
  { key: "scaffolded", label: "Scaffolded" },
  { key: "pr_open", label: "PR Open" },
  { key: "data_applied", label: "Data Applied" },
  { key: "runtime_provisioned", label: "Runtime Provisioned" },
  { key: "registered", label: "Registered" },
] as const;

/**
 * How many stages a given proposal status has COMPLETED. The proposal queue status
 * is the coarse driver; finer stages (scaffolded / pr_open / data_applied) are
 * confirmed from audit events when present so the stepper never overstates.
 */
export function completedStageCount(
  status: ProposalQueueStatus,
  auditEvents: Array<{ event: string }> = []
): number {
  const events = new Set(auditEvents.map((e) => e.event));

  // Terminal runtime state: 6 of 7 done (Registered still pending — Phase 19+).
  if (status === "runtime_provisioned") return 6;

  // Executed (data/exec path complete) but runtime not yet provisioned.
  if (status === "executed") {
    return events.has("data_provision_applied") ? 5 : 4;
  }

  if (status === "approved_for_execution" || status === "executing" || status === "execution_failed") {
    // Approved (2) plus whatever audit proves happened, capped before runtime.
    if (events.has("data_provision_applied")) return 5;
    if (events.has("github_pr_opened")) return 4;
    if (events.has("local_scaffold_built")) return 3;
    return 2;
  }

  if (status === "simulated_approved") return 2;
  if (status === "pending_approval") return 1;
  if (status === "draft") return 1;

  // rejected / expired — Plan happened, nothing advanced.
  return 1;
}

/**
 * Statuses with no actively-in-progress frontier. `runtime_provisioned` is the
 * terminal state of the 18D path — the next stage ("Registered") is a future
 * Phase-19+ concern, NOT in progress, so it renders `pending`, not `now`.
 * `rejected`/`expired` are halted — Plan is done, the rest are pending.
 */
const TERMINAL_STATUSES: ReadonlySet<ProposalQueueStatus> = new Set<ProposalQueueStatus>([
  "runtime_provisioned",
  "rejected",
  "expired",
]);

/**
 * Build the 7 lifecycle steps for a proposal. The first `completed` are `done`.
 * For an in-progress proposal the next step is `now` (the active frontier); for a
 * terminal proposal (e.g. runtime_provisioned) there is no active frontier, so the
 * remaining steps are `pending`. This is why runtime_provisioned shows 6 done and
 * "Registered" pending — not "now".
 */
export function buildLifecycleSteps(
  status: ProposalQueueStatus,
  auditEvents: Array<{ event: string }> = []
): LifecycleStep[] {
  const completed = completedStageCount(status, auditEvents);
  const terminal = TERMINAL_STATUSES.has(status);
  return LIFECYCLE_STAGES.map((stage, i) => {
    let state: StepState;
    if (i < completed) state = "done";
    else if (i === completed && !terminal) state = "now";
    else state = "pending";
    return { key: stage.key, label: stage.label, state };
  });
}
