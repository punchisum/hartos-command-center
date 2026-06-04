/**
 * src/command-center/approval-contract.ts
 *
 * Defines approval categories and reasons, and maps every gated action to the
 * approval it requires. This contract makes it impossible for a future UI to
 * accidentally treat a dangerous action as safe: anything that mutates
 * providers/Supabase/packs/production resolves to a human/admin gate or
 * "forbidden" — never "none".
 *
 * Phase 11G does not execute approvals. It only declares them.
 */

import type {
  ActionId,
  ApprovalCategory,
  ApprovalReason,
  ApprovalRule,
} from "./command-center-types.js";
import { ACTION_STATES, DANGEROUS_ACTIONS } from "./action-contract.js";

export const APPROVAL_CATEGORIES: ApprovalCategory[] = [
  "none",
  "human_review",
  "human_approval",
  "admin_approval",
  "forbidden",
];

export const APPROVAL_REASONS: ApprovalReason[] = [
  "provider_mutation",
  "supabase_mutation",
  "pack_promotion",
  "production_deploy",
  "secret_boundary",
  "third_party_code",
  "data_privacy",
  "business_critical",
];

/** Per-action approval rules. Gated actions must NOT be category "none". */
export const APPROVAL_RULES: Record<ActionId, ApprovalRule> = {
  view_report: { action: "view_report", category: "none", reasons: [], note: "Read-only local report view." },
  open_handover: { action: "open_handover", category: "none", reasons: [], note: "Read-only handover doc view." },
  review_pack: { action: "review_pack", category: "none", reasons: [], note: "Read-only pack manifest inspection." },
  generate_report: { action: "generate_report", category: "none", reasons: [], note: "Local deterministic report generation." },
  run_orchestrator: { action: "run_orchestrator", category: "none", reasons: [], note: "Local orchestrator run (recommendations only)." },
  run_strategy_review: { action: "run_strategy_review", category: "none", reasons: [], note: "Local strategy review (recommendations only)." },
  run_cto_review: { action: "run_cto_review", category: "none", reasons: [], note: "Local CTO review (recommendations only)." },
  run_build_plan: { action: "run_build_plan", category: "none", reasons: [], note: "Local build plan generation." },
  run_launch_verify: { action: "run_launch_verify", category: "none", reasons: [], note: "Local launch verification (read-only checks)." },
  run_bootstrap_verify: { action: "run_bootstrap_verify", category: "none", reasons: [], note: "Local bootstrap verification (read-only checks)." },

  approve_manual_required: {
    action: "approve_manual_required",
    category: "human_approval",
    reasons: ["business_critical"],
    note: "A human must approve a manual-required item before any downstream action.",
  },
  promote_pack: {
    action: "promote_pack",
    category: "admin_approval",
    reasons: ["pack_promotion", "third_party_code"],
    note: "Pack promotion only via existing safe gates (verification + provenance). Never auto.",
  },
  deploy_agent: {
    action: "deploy_agent",
    category: "human_approval",
    reasons: ["production_deploy"],
    note: "Deploy is manual/approval-gated. Phase 11G never deploys.",
  },
  execute_provider_mutation: {
    action: "execute_provider_mutation",
    category: "forbidden",
    reasons: ["provider_mutation", "supabase_mutation", "secret_boundary"],
    note: "Provider/Supabase mutation is forbidden in Phase 11G.",
  },
};

export function getApprovalRule(action: ActionId): ApprovalRule {
  return APPROVAL_RULES[action];
}

export function getApprovalCategory(action: ActionId): ApprovalCategory {
  return APPROVAL_RULES[action].category;
}

export function requiresApproval(action: ActionId): boolean {
  const category = getApprovalCategory(action);
  return category !== "none";
}

/**
 * Throws if any dangerous action resolves to approval category "none". Keeps the
 * approval contract and action contract from drifting apart.
 */
export function assertNoDangerousWithoutApproval(): void {
  for (const action of DANGEROUS_ACTIONS) {
    if (getApprovalCategory(action) === "none") {
      throw new Error(
        `Approval contract violation: dangerous action "${action}" has approval category "none".`
      );
    }
  }
  // Provider mutation must be forbidden, not merely gated.
  if (getApprovalCategory("execute_provider_mutation") !== "forbidden") {
    throw new Error("execute_provider_mutation must have approval category forbidden.");
  }
  // Cross-check: any action whose state is gated must carry a non-none approval.
  for (const action of Object.keys(APPROVAL_RULES) as ActionId[]) {
    const state = ACTION_STATES[action];
    const gatedState = state === "approval_required" || state === "manual_required" || state === "forbidden";
    if (gatedState && getApprovalCategory(action) === "none") {
      throw new Error(
        `Approval contract violation: action "${action}" has gated state "${state}" but approval "none".`
      );
    }
  }
}
