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
  | "agent_creation_plan"
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

/**
 * Queue status.
 *
 * Phase 14B base lifecycle (cockpit/Worker-settable, dry-run only):
 *   draft → pending_approval → simulated_approved | rejected | expired
 *
 * Phase 17C two-key execution lifecycle (see docs/AGENT_CREATION_EXECUTION_PHASE17C.md):
 *   simulated_approved → approved_for_execution   (Key 1: Hart authorizes the Node executor;
 *                                                   the cockpit/Worker CAN set this state)
 *   approved_for_execution → simulated_approved    (explicit revoke — no auto-expiry, per 17C §11)
 *   approved_for_execution → executing → executed | execution_failed
 *                                                   (Node executor ONLY — the cockpit/Worker can
 *                                                    NEVER set these; `executeProposal()` still throws)
 *
 * 17D (local scaffold dry-run) operates on an `approved_for_execution` proposal and does NOT
 * advance it to `executing`/`executed` — it produces local artifacts + a closed-gate provision
 * dry-run report and records an audit event only. Real execution (executing/executed) is 18B.
 *
 * Phase 18D (runtime-layer provisioning) introduces a terminal `runtime_provisioned` state. Per
 * Hart's locked 18D decision, the Node executor advances `approved_for_execution → runtime_provisioned`
 * ONLY when every runtime step (secrets → worker deploy → trigger → webhook) AND the read-only
 * smoke succeed. It is executor-only (the cockpit/Worker can never set it) and is a "provisioned"
 * state, NOT "launched" — production runtime remains separately gated/refused.
 */
export type ProposalQueueStatus =
  | "draft"
  | "pending_approval"
  | "simulated_approved"
  | "approved_for_execution"
  | "executing"
  | "executed"
  | "execution_failed"
  | "runtime_provisioned"
  | "rejected"
  | "expired";

/** Status transitions writable ONLY by the Node execution host, never by the cockpit/Worker. */
export const EXECUTOR_ONLY_STATUSES: readonly ProposalQueueStatus[] = [
  "executing",
  "executed",
  "execution_failed",
  "runtime_provisioned",
];

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
  /**
   * Phase 17C-5 / §11 Q2 — a durable spec id, distinct from the proposal id, assigned when the
   * proposal is authorized for execution. It survives proposal expiry/rejection and is the stable
   * reference the Node executor + the new agent's repo use. Null until authorized.
   */
  specId?: string | null;
  /**
   * Phase 17C §11 Q3 — when `approved_for_execution` was granted. Authorization does NOT auto-expire;
   * this exists so the cockpit can surface authorization AGE (staleness never self-clears — an
   * explicit revoke is required). Null when not authorized.
   */
  executionAuthorizedAt?: string | null;
}
