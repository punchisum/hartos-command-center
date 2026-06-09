/**
 * src/tasks/agent-task-lifecycle.ts
 *
 * The PURE, fail-closed lifecycle for the typed-task spine (`AgentTask`).
 *
 * It validates a transition against the `ALLOWED_TASK_TRANSITIONS` table AND the
 * executor-only guard, then (for a legal transition) returns a NEW task with the status
 * advanced, an audit event appended, and `updatedAt` set to the INJECTED `now`. An
 * illegal transition is REFUSED with a typed denial — it NEVER throws-open and NEVER
 * mutates the input.
 *
 * Fail-closed doctrine (mirrors proposal-types' EXECUTOR_ONLY_STATUSES + the execution
 * gate's `{ allowed, denials[] }` shape):
 *   - A transition not in the allowed map is denied.
 *   - A transition FROM a terminal state (done/failed/cancelled) is denied.
 *   - An EXECUTOR-ONLY target state (in_progress/done/failed) requested by a non-executor
 *     actor (cockpit/worker) is denied — the hosted read-only surface can never set them.
 *   - A no-op self-transition is denied (every transition is an explicit, audited step).
 *
 * PURE: no fs, no network, no env, no ambient clock. Time is INJECTED. Same inputs ⇒
 * deep-equal output. Worker-safe — could be surfaced read-only.
 */

import {
  ALLOWED_TASK_TRANSITIONS,
  EXECUTOR_ONLY_TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  type AgentTask,
  type AgentTaskActor,
  type AgentTaskStatus,
} from "./agent-task-types.js";

/**
 * Named denial codes (a transition is REFUSED, never thrown-open). Mirrors the
 * fail-closed denial style of the doctrine execution gate.
 */
export type TaskTransitionDenialCode =
  | "from_terminal"
  | "illegal_transition"
  | "executor_only"
  | "noop_self_transition";

export interface TaskTransitionCheck {
  /** True iff the transition is permitted. */
  allowed: boolean;
  /** The named denial code when refused; null when allowed. */
  denial: TaskTransitionDenialCode | null;
  /** Human-readable reason (fail-closed: always set when denied). */
  reason: string;
}

/** True when `status` is one only the Node executor may set. */
export function isExecutorOnlyStatus(status: AgentTaskStatus): boolean {
  return EXECUTOR_ONLY_TASK_STATUSES.includes(status);
}

/** True when `status` is terminal (no transition leaves it). */
export function isTerminalStatus(status: AgentTaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status);
}

/**
 * PURE. Decide whether `from → to` is permitted for `actor`. Returns a typed result; it
 * NEVER throws. Order of checks is fail-closed:
 *   1. self-transition (no-op) → denied,
 *   2. FROM a terminal state → denied,
 *   3. not in the allowed-transition table → denied,
 *   4. an executor-only target requested by a non-executor actor → denied.
 * Only if all pass is the transition allowed.
 */
export function canTransition(
  from: AgentTaskStatus,
  to: AgentTaskStatus,
  actor: AgentTaskActor,
): TaskTransitionCheck {
  if (from === to) {
    return {
      allowed: false,
      denial: "noop_self_transition",
      reason: `no-op self-transition (${from} → ${to}) is not an audited step`,
    };
  }

  if (isTerminalStatus(from)) {
    return {
      allowed: false,
      denial: "from_terminal",
      reason: `'${from}' is terminal; no transition leaves it`,
    };
  }

  const allowedTargets = ALLOWED_TASK_TRANSITIONS[from];
  if (!allowedTargets.includes(to)) {
    return {
      allowed: false,
      denial: "illegal_transition",
      reason: `transition '${from}' → '${to}' is not allowed`,
    };
  }

  if (actor !== "executor" && isExecutorOnlyStatus(to)) {
    return {
      allowed: false,
      denial: "executor_only",
      reason: `'${to}' is executor-only; actor '${actor}' may not set it (cockpit/worker can never mark a task in_progress/done/failed)`,
    };
  }

  return { allowed: true, denial: null, reason: `transition '${from}' → '${to}' permitted` };
}

/** Options for applying a transition (time is INJECTED — never an ambient clock read). */
export interface ApplyTransitionOpts {
  /** The injected wall-clock ISO string written to updatedAt + the audit event. */
  now: string;
  /** Who is driving the transition. Defaults to "executor" only when omitted is unsafe;
   *  callers should pass the real actor. */
  actor: AgentTaskActor;
  /** Optional detail recorded on the appended audit event. */
  detail?: string;
}

/** A refused application — the task is returned UNCHANGED with the denial. Never throws. */
export interface ApplyTransitionRefused {
  ok: false;
  /** The unchanged input task (no mutation). */
  task: AgentTask;
  denial: TaskTransitionDenialCode;
  reason: string;
}

/** A successful application — a NEW task with status advanced + audit appended. */
export interface ApplyTransitionApplied {
  ok: true;
  task: AgentTask;
}

export type ApplyTransitionResult = ApplyTransitionApplied | ApplyTransitionRefused;

/**
 * PURE. Advance `task` to `to`, fail-closed.
 *
 * On a LEGAL transition: returns `{ ok: true, task }` where `task` is a NEW object (the
 * input is never mutated) with `status = to`, `updatedAt = opts.now`, and a new audit
 * event appended. On an ILLEGAL transition: returns `{ ok: false, task, denial, reason }`
 * with the UNCHANGED input task — it NEVER throws-open.
 *
 * Deterministic: same `task` + same `to` + same `opts` ⇒ deep-equal result.
 */
export function applyTransition(
  task: AgentTask,
  to: AgentTaskStatus,
  opts: ApplyTransitionOpts,
): ApplyTransitionResult {
  const check = canTransition(task.status, to, opts.actor);
  if (!check.allowed) {
    return {
      ok: false,
      task,
      denial: check.denial!,
      reason: check.reason,
    };
  }

  const event = {
    at: opts.now,
    event: `transition:${task.status}->${to}`,
    ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
  };

  const next: AgentTask = {
    ...task,
    status: to,
    updatedAt: opts.now,
    auditEvents: [...task.auditEvents, event],
  };

  return { ok: true, task: next };
}
