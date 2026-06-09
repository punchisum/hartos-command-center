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

export type ProposalDomain = "fitness" | "ops" | "factory" | "system" | "research";

export type ProposalActionType =
  | "build_agent_plan"
  | "agent_creation_plan"
  | "improve_agent_plan"
  | "ops_followup_plan"
  | "fitness_adjustment_plan"
  | "ranked_build_plan"
  | "sync_repair_plan"
  | "review_plan"
  | "research_plan";

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

/**
 * Mutation Tiering Model (3-levels-up master plan §10). Every typed action declares
 * its tier; the gate requires that tier's payload subset and refuses if a required
 * field is missing. Doctrine (typed + audit + approval-floor) is never optional — the
 * tier only scales the PAYLOAD with risk, never the doctrine.
 *
 *   T0 — internal low-risk cleanup     (e.g. archive a rejected proposal)
 *   T1 — internal lifecycle            (e.g. approve_for_execution; needs live status verification)
 *   T2 — ops mirror                    (e.g. mark an ops item reviewed; read-before-write)
 *   T3 — external                      (e.g. ClickUp comment / move; full before/after payload)
 *   T4 — irreversible / cost-bearing   (e.g. deploy infra; explicit human gate EVERY time)
 *
 * Tier rides the EXISTING jsonb proposal payload — it is an additive, optional field.
 * The required-field map + the pure assertion live in `proposal-tiering.ts`.
 */
export type ProposalTier = "T0" | "T1" | "T2" | "T3" | "T4";

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

  // ─── Mutation-tiering fields (master plan §10/§11) — ADDITIVE & OPTIONAL ────────
  // These ride the existing jsonb payload. They are optional so every proposal that
  // predates tiering remains valid; the pure `assertTierPayloadComplete` (see
  // proposal-tiering.ts) decides whether a given tier's required subset is present.
  // NONE of these introduce an execution path — they are descriptive only.

  /** Risk/payload tier (master plan §10). Drives which payload subset the gate requires. */
  tier?: ProposalTier;
  /** The confirmed target's stable id (e.g. proposal id, card id). No "apply to all". */
  targetId?: string;
  /** Human-readable target name, surfaced in the Mutation Center. */
  targetName?: string;
  /** Read-before-write snapshot of the target BEFORE the (future) mutation. Descriptive only. */
  beforeState?: Record<string, unknown>;
  /** Intended target state AFTER the (future) mutation. Descriptive only; nothing is executed. */
  afterState?: Record<string, unknown>;
  /**
   * Deterministic idempotency key (see src/lib/idempotency-key.ts — build it with
   * `makeIdempotencyKey`; never hand-roll one here). Present for tiers that mutate.
   */
  idempotencyKey?: string;
  /** Rollback or correction note: how a (future) mutation would be undone or corrected. */
  rollbackOrCorrectionNote?: string;
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

// ─── Master plan §11 — TypedActionProposal ───────────────────────────────────
/**
 * A `TypedActionProposal` is the canonical `ActionProposal` with the tier made
 * REQUIRED. It is NOT a fork: it references the same id/domain/title/riskLevel/
 * dryRunResult fields, never re-declaring them, so there is a single source of truth.
 * The pure gate (`assertTierPayloadComplete` in proposal-tiering.ts) then requires
 * the rest of the tier's payload subset. This carries NO execution path — it is the
 * shape a mutation proposal MUST satisfy before the (separate) execution gate is even
 * consulted.
 */
export type TypedActionProposal = ActionProposal & { tier: ProposalTier };
