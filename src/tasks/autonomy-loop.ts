/**
 * src/tasks/autonomy-loop.ts — 3-levels-up master plan L3-3C: the GATED autonomy loop.
 *
 * The doctrine demands a loop that can REASON and PROPOSE but is structurally INCAPABLE
 * of approving or executing. This module is that loop's PURE engine. It does two things,
 * and ONLY these two — both stopping at the human-approval floor:
 *
 *   1. proposeTasksFromSuggestions — turn advisory `SuggestedAction`s (and, optionally,
 *      synthesized `FleetRisk`s) into durable `AgentTask` records in the INITIAL `queued`
 *      status, each carrying `requiredApproval: "Hart"`, the authorizing proposal id where
 *      known, and a stamped audit event. It NEVER mints a task in an approved/executor state.
 *
 *   2. advanceAutonomously — acting as a NON-executor actor (default "system"), attempt to
 *      progress each task through ONLY the non-executor transitions the lifecycle allows
 *      (e.g. queued → assigned). ANY attempt at an EXECUTOR-ONLY target (in_progress / done /
 *      failed) is REFUSED — collected in `refusals`, never applied. The loop NEVER calls
 *      `applyTransition` with `actor: "executor"`, and it has no concept of "approve".
 *
 * THE HUMAN-APPROVAL FLOOR (NON-NEGOTIABLE, enforced BY CONSTRUCTION):
 *   - The loop's actor is a NON-executor (`AutonomyActor` excludes "executor" at the TYPE
 *     level — there is no code path that can pass "executor" to the lifecycle).
 *   - Reaching an executor-only state therefore relies on the EXISTING `canTransition`
 *     guard: `actor !== "executor" && isExecutorOnlyStatus(to)` → denial `executor_only`.
 *     We REUSE that guard verbatim; we do not weaken or re-implement it.
 *   - There is NO "approve" concept here at all. The loop produces PROPOSED work and
 *     shepherds it at most to `assigned`; approval + execution stay entirely Hart's and the
 *     separate execution gate's.
 *
 * Honesty contract: a task synthesized/merged from multiple inputs keeps the WEAKEST signal
 * (we never upgrade priority/confidence by combining), and we never fabricate authorization
 * (a task without a known authorizing proposal carries `authorizingProposalId: null`).
 *
 * PURE + Worker-safe: no fs / network / clock / env / random. `now` (and the actor) are
 * INJECTED. Same inputs ⇒ deep-equal output. The only VALUE imports are the pure lifecycle
 * helpers (`canTransition`, `ALLOWED_TASK_TRANSITIONS`, `isExecutorOnlyStatus`) and the pure
 * `applyTransition` — all themselves Node-free. Every heavy/domain shape is `import type`.
 */

import {
  ALLOWED_TASK_TRANSITIONS,
  type AgentTask,
  type AgentTaskActor,
  type AgentTaskAuditEvent,
  type AgentTaskStatus,
  type AgentTaskType,
} from "./agent-task-types.js";
import {
  applyTransition,
  canTransition,
  isExecutorOnlyStatus,
} from "./agent-task-lifecycle.js";
import type { SuggestedAction } from "../cockpit/suggestions/suggest-actions.js";
import type { FleetRisk } from "../fleet/fleet-synthesis.js";

/**
 * The autonomy loop's actor is a NON-executor BY TYPE — "executor" is excluded so there is
 * no code path through which the loop can drive an executor-only transition. The human floor
 * is enforced here at the type level, then again at runtime by `canTransition`.
 */
export type AutonomyActor = Exclude<AgentTaskActor, "executor">;

/** The INITIAL status every proposed task is born in — never approved, never executor. */
export const AUTONOMY_INITIAL_STATUS = "queued" as const satisfies AgentTaskStatus;

/** The single, benign non-executor step the loop is willing to take autonomously. */
const AUTONOMY_BENIGN_TARGET = "assigned" as const satisfies AgentTaskStatus;

// ─── proposeTasksFromSuggestions ───────────────────────────────────────────────────

export interface ProposeTasksOptions {
  /** Injected wall-clock ISO string — used for createdAt/updatedAt and the audit stamp. */
  now: string;
  /**
   * Optional synthesized fleet risks to ALSO propose from (advisory corroboration). They
   * never raise a task's standing; each becomes its own queued, Hart-gated proposal.
   */
  risks?: FleetRisk[];
  /**
   * Optional explicit per-suggestion authorizing-proposal links. When a suggestion id is
   * present here, the proposed task records that proposal id; otherwise it is honestly null.
   * (We do NOT fabricate authorization from free-text.)
   */
  authorizingProposalIds?: Record<string, string>;
}

/**
 * Map a suggestion's `actionType` onto the task vocabulary. Both reuse the canonical
 * `ProposalActionType`, so this is the identity — declared explicitly so the contract is
 * visible and a future divergence is caught by the compiler.
 */
function suggestionTaskType(s: SuggestedAction): AgentTaskType {
  return s.actionType;
}

/** A fleet risk → the conservative, queue-hygiene task type (it is a synthesized signal). */
function riskTaskType(): AgentTaskType {
  return "sync_repair_plan";
}

function genesisEvent(now: string, detail: string): AgentTaskAuditEvent {
  return { at: now, event: "autonomy:proposed", detail };
}

/**
 * PURE. Turn advisory suggestions (and optional synthesized risks) into durable
 * `AgentTask`s, each in the INITIAL `queued` status with `requiredApproval: "Hart"`, a
 * stamped genesis audit event, and the authorizing proposal id where known (else null).
 *
 * It NEVER produces a task in an approved or executor-only state — every output is `queued`.
 * Deterministic: same inputs ⇒ deep-equal output (no clock/random; `now` is injected).
 */
export function proposeTasksFromSuggestions(
  suggestions: readonly SuggestedAction[],
  opts: ProposeTasksOptions,
): AgentTask[] {
  const now = opts.now;
  const links = opts.authorizingProposalIds ?? {};
  const tasks: AgentTask[] = [];

  for (const s of suggestions) {
    const authorizingProposalId = Object.prototype.hasOwnProperty.call(links, s.id)
      ? links[s.id]!
      : null;
    tasks.push({
      id: `task-${s.id}`,
      domain: s.domain,
      owner: null,
      taskType: suggestionTaskType(s),
      title: s.title,
      payload: {
        source: s.source,
        priority: s.priority,
        rationale: s.rationale,
        suggestionId: s.id,
      },
      // The floor: born queued — never approved, never executor.
      status: AUTONOMY_INITIAL_STATUS,
      authorizingProposalId,
      requiredApproval: "Hart",
      auditEvents: [
        genesisEvent(now, `proposed from ${s.source} suggestion "${s.title}" (priority ${s.priority})`),
      ],
      createdAt: now,
      updatedAt: now,
    });
  }

  for (const r of opts.risks ?? []) {
    tasks.push({
      id: `task-risk-${r.subject}`,
      // FleetRisk has no proposal domain; "system" is the honest cross-fleet domain.
      domain: "system",
      owner: null,
      taskType: riskTaskType(),
      title: `Address fleet risk: ${r.subject}`,
      payload: {
        source: "fleet-synthesis",
        subject: r.subject,
        sources: r.sources,
        severity: r.severity,
        // Honesty: carry the risk's OWN (already-clamped, never laundered) confidence band.
        confidence: r.confidence,
        why: r.why,
      },
      status: AUTONOMY_INITIAL_STATUS,
      // A synthesized risk has no single authorizing proposal — honest null, never fabricated.
      authorizingProposalId: null,
      requiredApproval: "Hart",
      auditEvents: [
        genesisEvent(now, `proposed from synthesized fleet risk "${r.subject}" (severity ${r.severity}, confidence ${r.confidence})`),
      ],
      createdAt: now,
      updatedAt: now,
    });
  }

  return tasks;
}

// ─── advanceAutonomously ─────────────────────────────────────────────────────────────

/** One refused advance — what was attempted and why the floor stopped it. */
export interface AutonomyRefusal {
  taskId: string;
  to: AgentTaskStatus;
  reason: string;
}

export interface AdvanceAutonomouslyOptions {
  /** Injected wall-clock ISO string written to any applied transition. */
  now: string;
  /**
   * The NON-executor actor the loop runs as (default "system" via "cockpit"). It can NEVER
   * be "executor" — the type excludes it, so the loop has no path to an executor-only state.
   */
  actor?: AutonomyActor;
}

export interface AdvanceAutonomouslyResult {
  /**
   * Tasks the loop legally advanced (at most one benign non-executor step each — e.g.
   * queued → assigned). A task it could not benignly advance is returned UNCHANGED.
   */
  advanced: AgentTask[];
  /**
   * Every executor-only target the loop attempted and the floor REFUSED — collected, never
   * applied. PROOF the loop cannot self-execute: these never appear in `advanced`.
   */
  refusals: AutonomyRefusal[];
}

/**
 * The executor-only targets the loop will deliberately ATTEMPT (and expect to be refused),
 * so the refusal is observable rather than silently skipped. Sourced from the lifecycle's
 * own table for the task's current status, filtered to executor-only — never hand-listed.
 */
function executorOnlyTargetsFrom(from: AgentTaskStatus): AgentTaskStatus[] {
  return ALLOWED_TASK_TRANSITIONS[from].filter((to) => isExecutorOnlyStatus(to));
}

/**
 * PURE. As a NON-executor actor, advance each task by AT MOST one benign non-executor step
 * (queued → assigned, when the lifecycle permits it for this actor), and RECORD a refusal
 * for every executor-only target the task could otherwise structurally reach.
 *
 * The human-approval floor is enforced two ways, both reused — never re-implemented:
 *   1. TYPE: `opts.actor` is an `AutonomyActor` (no "executor"), so `applyTransition` is
 *      NEVER called with an executor actor.
 *   2. RUNTIME: every executor-only target is checked via `canTransition` and lands in
 *      `refusals` (denial `executor_only`); the loop never applies it.
 *
 * Deterministic + idempotent: same inputs ⇒ deep-equal output, and a task that is already
 * past the benign step (or terminal) is returned unchanged with no spurious advance.
 */
export function advanceAutonomously(
  tasks: readonly AgentTask[],
  opts: AdvanceAutonomouslyOptions,
): AdvanceAutonomouslyResult {
  const now = opts.now;
  // Default to "cockpit" — a concrete non-executor surface. Never "executor" (type-barred).
  const actor: AutonomyActor = opts.actor ?? "cockpit";

  const advanced: AgentTask[] = [];
  const refusals: AutonomyRefusal[] = [];

  for (const task of tasks) {
    const from = task.status;

    // 1. Record a refusal for EVERY executor-only target reachable in the table from `from`.
    //    The loop attempts them via the SAME guard the executor host obeys — and is refused.
    for (const to of executorOnlyTargetsFrom(from)) {
      const check = canTransition(from, to, actor);
      // By construction a non-executor actor is refused here; assert the invariant defensively.
      if (!check.allowed) {
        refusals.push({ taskId: task.id, to, reason: check.reason });
      }
    }

    // 2. Attempt the ONE benign non-executor advance (queued → assigned), if the lifecycle
    //    allows it for this actor at this status. Anything else is left untouched (idempotent).
    const benignCheck = canTransition(from, AUTONOMY_BENIGN_TARGET, actor);
    if (benignCheck.allowed) {
      const res = applyTransition(task, AUTONOMY_BENIGN_TARGET, {
        now,
        actor,
        detail: "autonomy-loop benign advance (non-executor, pre-approval)",
      });
      // applyTransition re-checks; on the off-chance it refused, keep the task unchanged.
      advanced.push(res.ok ? res.task : task);
    } else {
      advanced.push(task);
    }
  }

  return { advanced, refusals };
}
