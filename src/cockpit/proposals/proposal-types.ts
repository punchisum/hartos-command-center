/**
 * src/cockpit/proposals/proposal-types.ts
 *
 * Phase 14A — Safe Action Proposal contract. This is PROPOSAL + APPROVAL
 * architecture ONLY. There is NO real execution method anywhere in this module.
 *
 * A proposal is a non-executable DRAFT describing what an action WOULD do. It
 * carries a dry-run/simulation result (what would happen, what data would be
 * touched, what approval is required, and why real execution is disabled).
 */

export type ProposalDomain = "fitness" | "ops" | "factory" | "system";

export type ProposalActionType =
  | "build_agent_plan"
  | "improve_agent_plan"
  | "ops_followup_plan"
  | "fitness_adjustment_plan"
  | "ranked_build_plan"
  | "sync_repair_plan"
  | "review_plan";

/**
 * Lifecycle. NOTE: there is intentionally no `executed` / `approved_executed`
 * state — execution is unsupported in Phase 14A.
 *   draft               — generated, not yet advanced (default).
 *   pending_approval     — surfaced for Hart's approval (proposals gate on).
 *   approved_simulated   — Hart approved a SIMULATION only (no real effect).
 *   rejected             — declined.
 *   expired              — past its expiry.
 */
export type ProposalStatus = "draft" | "pending_approval" | "approved_simulated" | "rejected" | "expired";

export type ProposalRisk = "low" | "medium" | "high";

/** Result of a dry-run/simulation. Describes intent only — nothing happened. */
export interface DryRunResult {
  /** Plain-English description of what WOULD happen. */
  wouldHappen: string;
  /** Read-only description of data/files that WOULD be touched (no writes done). */
  dataWouldTouch: string[];
  /** Approval needed before any future real execution. */
  approvalRequired: string;
  /** Why real execution is currently disabled. */
  executionDisabledReason: string;
  /** What future setup is required to enable execution (informational). */
  futureSetupRequired: string[];
  /** Always false in Phase 14A — proves nothing was executed. */
  executed: false;
}

export interface ActionProposal {
  id: string;
  domain: ProposalDomain;
  actionType: ProposalActionType;
  title: string;
  description: string;
  /** The cockpit intent / request that produced this proposal. */
  sourceIntent: string;
  /** Proposed payload — descriptive only, never sent anywhere. */
  proposedPayload: Record<string, unknown>;
  expectedEffect: string;
  riskLevel: ProposalRisk;
  /** Always "Hart" in Phase 14A. */
  requiredApproval: "Hart";
  status: ProposalStatus;
  createdAt: string;
  expiresAt: string | null;
  safetyNotes: string[];
  /** Why the proposal is not executable (always set in Phase 14A). */
  blockedReason: string;
  /** Dry-run/simulation result when simulated, else null. */
  dryRunResult: DryRunResult | null;
  /** Always false — there is no execution path. */
  executable: false;
}

// ─── Phase 14B — local proposal queue ────────────────────────────────────────

/** Queue status. NOTE: still no executed state — execution is unsupported. */
export type ProposalQueueStatus = "draft" | "pending_approval" | "simulated_approved" | "rejected" | "expired";

export interface ProposalAuditEvent {
  at: string;
  event: string;
  detail?: string;
}

/** A persisted proposal in the local (gitignored) queue. */
export interface ProposalQueueItem extends Omit<ActionProposal, "status"> {
  status: ProposalQueueStatus;
  updatedAt: string;
  auditEvents: ProposalAuditEvent[];
}
