/**
 * src/tasks/agent-task-types.ts
 *
 * The typed-task spine — `AgentTask`: a DURABLE, typed task record (one row per task)
 * for the gated autonomy loop (propose → approve → execute → audit). This is the
 * persistent, typed-task analog of the in-memory `AgentJob` (../research/agent-job-types):
 * where `AgentJob` is the universal job CONTRACT a born agent interrogates/scopes, an
 * `AgentTask` is the durable unit of WORK the fleet orchestrator routes and the (future,
 * gated) executor advances through a fail-closed lifecycle.
 *
 * This module is the TYPE foundation + the allowed-transition table only. The PURE
 * lifecycle behavior (validate/apply a transition) lives in ./agent-task-lifecycle.ts.
 * There is NO executor here and NO I/O — these are pure contracts.
 *
 * Doctrine baked into the shape (mirrors proposal-types' EXECUTOR_ONLY_STATUSES):
 *   - Fail-closed lifecycle: an illegal transition is REFUSED, never throws-open.
 *   - Executor-only states (in_progress / done / failed) can be set ONLY by the Node
 *     execution host. The cockpit/Worker may queue/assign/cancel but can NEVER mark a
 *     task in_progress/done/failed — exactly the proposal-queue guard pattern.
 *   - No authorizing proposal/spec + no required approval = no execution; the task
 *     carries the link + the approval floor so the (separate) execution gate can refuse.
 *   - Audit trail is part of the record (no audit = no completion).
 *
 * Canonical types are IMPORTED, never redeclared:
 *   - ProposalDomain / ProposalActionType ← ../cockpit/proposals/proposal-types.js
 *     (the task's domain + action vocabulary is the SAME vocabulary proposals use).
 *   - AgentType                           ← ../agents/agent-types.js (the owning agent).
 */

import type { AgentType } from "../agents/agent-types.js";
import type {
  ProposalActionType,
  ProposalDomain,
} from "../cockpit/proposals/proposal-types.js";

/**
 * The task's domain reuses the proposal domain word-set (fitness/ops/factory/system/
 * research) — a durable task and the proposal that authorizes it speak the same domains.
 */
export type AgentTaskDomain = ProposalDomain;

/**
 * What the task WOULD do, reusing the canonical proposal action vocabulary so a task and
 * its authorizing `ActionProposal` are the same typed action. Imported, never redeclared.
 */
export type AgentTaskType = ProposalActionType;

/**
 * AgentTask lifecycle (fail-closed):
 *
 *   queued ──▶ assigned ──▶ in_progress ──▶ done
 *     │           │              │     └────▶ failed
 *     └───────────┴──────────────┴──────────▶ cancelled   (pre-terminal states only)
 *
 *   queued       — durably recorded, not yet routed to an owner (default).
 *   assigned     — routed to an owning agent; not yet picked up.
 *   in_progress  — the Node executor has started work (EXECUTOR-ONLY).
 *   done         — completed successfully (EXECUTOR-ONLY, terminal).
 *   failed       — execution failed (EXECUTOR-ONLY, terminal).
 *   cancelled    — withdrawn before completion by the cockpit/Worker (terminal).
 *
 * `done` / `failed` / `cancelled` are terminal — no transition leaves them. The cockpit/
 * Worker may set queued/assigned/cancelled; only the executor may set in_progress/done/
 * failed (see EXECUTOR_ONLY_TASK_STATUSES).
 */
export type AgentTaskStatus =
  | "queued"
  | "assigned"
  | "in_progress"
  | "done"
  | "failed"
  | "cancelled";

/**
 * Status transitions writable ONLY by the Node execution host, never by the cockpit/
 * Worker. Mirrors `EXECUTOR_ONLY_STATUSES` in proposal-types.ts: the hosted read-only
 * surface can queue/assign/cancel a task but can NEVER mark it in_progress/done/failed.
 */
export const EXECUTOR_ONLY_TASK_STATUSES: readonly AgentTaskStatus[] = [
  "in_progress",
  "done",
  "failed",
];

/**
 * Terminal statuses — no transition leaves them (fail-closed: a transition FROM a
 * terminal state is always refused).
 */
export const TERMINAL_TASK_STATUSES: readonly AgentTaskStatus[] = [
  "done",
  "failed",
  "cancelled",
];

/**
 * The allowed-transition map. A transition `from → to` is legal IFF `to` is in
 * `ALLOWED_TASK_TRANSITIONS[from]`. Terminal states map to an empty list. This is the
 * single source of truth the pure lifecycle (./agent-task-lifecycle.ts) reads — it does
 * NOT decide WHO may make the transition (that's the executor-only guard, layered on top).
 */
export const ALLOWED_TASK_TRANSITIONS: Readonly<
  Record<AgentTaskStatus, readonly AgentTaskStatus[]>
> = {
  queued: ["assigned", "in_progress", "cancelled"],
  assigned: ["in_progress", "cancelled"],
  in_progress: ["done", "failed", "cancelled"],
  done: [],
  failed: [],
  cancelled: [],
};

/** Who may drive a transition — the executor-only guard keys off this (no I/O). */
export type AgentTaskActor = "cockpit" | "worker" | "executor";

/**
 * One immutable audit entry on the task's trail (audit = completion requirement).
 * Same shape as proposal/job audit events for cross-surface consistency.
 */
export interface AgentTaskAuditEvent {
  at: string;
  event: string;
  detail?: string;
}

/**
 * The durable, typed task record — one row per task (see the planning-only migration
 * supabase/migrations/<ts>_agent_tasks.sql). A DATA contract: behavior lives in the pure
 * lifecycle module. Additive and aligned with the proposal/job canon.
 */
export interface AgentTask {
  /** Stable task id (deterministic — never a clock/random value baked in by this type). */
  id: string;
  /** The domain this task belongs to (reuses the proposal domain word-set). */
  domain: AgentTaskDomain;
  /** The owning agent id/owner string (e.g. an AgentRegistration id), null until assigned. */
  owner: string | null;
  /** The owning agent's type, when known (read-only context). */
  ownerAgentType?: AgentType;
  /** What the task WOULD do — the canonical proposal action vocabulary. */
  taskType: AgentTaskType;
  /** Short human title. */
  title: string;
  /** Descriptive payload — never sent anywhere by these types; the executor is separate. */
  payload: Record<string, unknown>;
  /** Current lifecycle status. */
  status: AgentTaskStatus;

  /**
   * Link to the authorizing proposal/spec id (no authorizing proposal = no execution).
   * Null while the task is merely queued; the execution gate refuses without it.
   */
  authorizingProposalId: string | null;
  /** A durable spec id distinct from the proposal id, when one was assigned. */
  authorizingSpecId?: string | null;
  /** The approval floor — always "Hart" in this build (mirrors ActionProposal). */
  requiredApproval: "Hart";

  /** Immutable audit trail (no audit = no completion). */
  auditEvents: AgentTaskAuditEvent[];

  createdAt: string;
  updatedAt: string;
}
