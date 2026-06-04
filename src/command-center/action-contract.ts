/**
 * src/command-center/action-contract.ts
 *
 * Defines every Command Center action and its state. Phase 11G NEVER executes
 * actions — this is a contract only. The point of this file is to make it
 * impossible for a future cockpit UI to treat a dangerous action as safe.
 *
 * Rules (enforced by tests):
 *   execute_provider_mutation = forbidden
 *   promote_pack              = approval_required (existing safe gates only)
 *   deploy_agent              = manual_required
 *   view_report               = read_only
 *   generate_report           = local_report_generation
 *
 * No provider mutation. No Supabase mutation. No pack mutation. No network.
 */

import type { ActionId, ActionState } from "./command-center-types.js";

/** Canonical action → state map. Single source of truth for the UI. */
export const ACTION_STATES: Record<ActionId, ActionState> = {
  // Read-only — safe to expose freely.
  view_report: "read_only",
  open_handover: "read_only",
  review_pack: "read_only",

  // Local report generation — deterministic, offline, no mutation.
  generate_report: "local_report_generation",
  run_orchestrator: "local_report_generation",
  run_strategy_review: "local_report_generation",
  run_cto_review: "local_report_generation",
  run_build_plan: "local_report_generation",
  run_launch_verify: "local_report_generation",
  run_bootstrap_verify: "local_report_generation",

  // Gated — never auto, never read_only.
  approve_manual_required: "approval_required",
  promote_pack: "approval_required",
  deploy_agent: "manual_required",

  // Forbidden in Phase 11G (and forbidden from any auto path).
  execute_provider_mutation: "forbidden",
};

/**
 * Actions that mutate providers, Supabase, packs, or production. These must
 * NEVER be read_only or local_report_generation. They are always gated.
 */
export const MUTATION_ACTIONS: ActionId[] = [
  "execute_provider_mutation",
  "promote_pack",
  "deploy_agent",
];

/**
 * Dangerous actions — anything that could change real-world state or approve
 * something irreversible. The UI must never render these as one-click-safe.
 */
export const DANGEROUS_ACTIONS: ActionId[] = [
  ...MUTATION_ACTIONS,
  "approve_manual_required",
];

/** States that are safe to expose without any gate. */
export const SAFE_STATES: ActionState[] = ["read_only", "local_report_generation"];

/** States that require a human/admin gate or are outright blocked. */
export const GATED_STATES: ActionState[] = [
  "approval_required",
  "manual_required",
  "forbidden",
];

export function getActionState(action: ActionId): ActionState {
  return ACTION_STATES[action];
}

export function isDangerous(action: ActionId): boolean {
  return DANGEROUS_ACTIONS.includes(action);
}

export function isMutationAction(action: ActionId): boolean {
  return MUTATION_ACTIONS.includes(action);
}

export function isSafeToExpose(action: ActionId): boolean {
  return SAFE_STATES.includes(getActionState(action));
}

/**
 * Throws if any dangerous action has been mis-declared as safe. Called by the
 * report/contract builders so a misconfiguration can never ship silently.
 */
export function assertNoDangerousReadOnly(): void {
  for (const action of DANGEROUS_ACTIONS) {
    const state = getActionState(action);
    if (SAFE_STATES.includes(state)) {
      throw new Error(
        `Action contract violation: dangerous action "${action}" is declared as "${state}". ` +
          `Dangerous actions must be approval_required, manual_required, or forbidden.`
      );
    }
  }
  // Mutation actions in particular must be in the gated set.
  for (const action of MUTATION_ACTIONS) {
    const state = getActionState(action);
    if (!GATED_STATES.includes(state)) {
      throw new Error(
        `Action contract violation: mutation action "${action}" has non-gated state "${state}".`
      );
    }
  }
  // Hard rule: provider mutation is forbidden in Phase 11G.
  if (getActionState("execute_provider_mutation") !== "forbidden") {
    throw new Error("execute_provider_mutation must be forbidden in Phase 11G.");
  }
}

export function actionsByState(): Record<ActionState, ActionId[]> {
  const out: Record<ActionState, ActionId[]> = {
    read_only: [],
    local_report_generation: [],
    approval_required: [],
    manual_required: [],
    forbidden: [],
    future: [],
  };
  for (const action of Object.keys(ACTION_STATES) as ActionId[]) {
    out[ACTION_STATES[action]].push(action);
  }
  return out;
}
