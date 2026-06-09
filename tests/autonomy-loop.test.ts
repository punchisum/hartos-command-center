/**
 * tests/autonomy-loop.test.ts
 *
 * The GATED autonomy loop (L3-3C) — propose-only, NEVER self-approve/execute. These tests
 * PROVE THE HUMAN-APPROVAL FLOOR:
 *
 *   - proposeTasksFromSuggestions yields ONLY tasks in the initial `queued` status, each
 *     `requiredApproval: "Hart"` — never an approved/executor-only state; authorization is
 *     honest (proposal id where given, else null); deterministic.
 *   - advanceAutonomously, run as a NON-executor actor, advances at MOST a benign
 *     non-executor step (queued → assigned) and REFUSES every executor-only target
 *     (in_progress / done / failed) — they appear in `refusals`, NEVER in `advanced`.
 *   - an EXHAUSTIVE check: starting from every status and iterating the loop to a fixed
 *     point, NO sequence of autonomy-loop calls can ever reach an executor-only state
 *     (in_progress / done / failed). The only way past the floor is an EXECUTOR actor — and
 *     the loop's actor type structurally excludes "executor".
 *   - determinism + idempotence.
 *
 * The mechanism relied on is the EXISTING lifecycle guard, reused verbatim:
 *   `canTransition` denies `actor !== "executor" && isExecutorOnlyStatus(to)` with denial
 *   `executor_only`. The loop never calls `applyTransition` with `actor: "executor"` (its
 *   `AutonomyActor` type excludes it). This test re-checks both.
 *
 * Fully HERMETIC: no env / network / fs / clock — `now` and the actor are injected.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EXECUTOR_ONLY_TASK_STATUSES,
  type AgentTask,
  type AgentTaskStatus,
} from "../src/tasks/agent-task-types.js";
import {
  advanceAutonomously,
  proposeTasksFromSuggestions,
  type AutonomyActor,
} from "../src/tasks/autonomy-loop.js";
import type { SuggestedAction } from "../src/cockpit/suggestions/suggest-actions.js";
import type { FleetRisk } from "../src/fleet/fleet-synthesis.js";

const NOW = "2026-06-09T12:00:00.000Z";
const LATER = "2026-06-09T13:00:00.000Z";

const NON_EXECUTOR_ACTORS: AutonomyActor[] = ["cockpit", "worker"];
const ALL_STATUSES: AgentTaskStatus[] = [
  "queued",
  "assigned",
  "in_progress",
  "done",
  "failed",
  "cancelled",
];

function suggestion(over: Partial<SuggestedAction> = {}): SuggestedAction {
  return {
    id: "sg-orchestrator-build-an-agent-for-tax-work",
    domain: "system",
    actionType: "build_agent_plan",
    title: 'Build an agent for "tax" work',
    rationale: "Capability gap detected by the orchestrator.",
    source: "orchestrator",
    priority: "high",
    ...over,
  };
}

function fleetRisk(over: Partial<FleetRisk> = {}): FleetRisk {
  return {
    subject: "ops",
    sources: ["briefing", "perception"],
    severity: 3,
    confidence: "low",
    why: "Ops backlog is growing while the briefing band is low.",
    ...over,
  };
}

/** A bare task fixture at any status — for driving advanceAutonomously directly. */
function task(status: AgentTaskStatus, id = "task-fixture"): AgentTask {
  return {
    id,
    domain: "system",
    owner: null,
    taskType: "sync_repair_plan",
    title: "Fixture task",
    payload: {},
    status,
    authorizingProposalId: null,
    requiredApproval: "Hart",
    auditEvents: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("autonomy-loop — proposeTasksFromSuggestions (propose-only, born at the floor)", () => {
  it("yields ONLY queued, Hart-required tasks — never approved/executor", () => {
    const tasks = proposeTasksFromSuggestions(
      [
        suggestion(),
        suggestion({ id: "sg-triage-clear-the-ops-backlog", domain: "ops", actionType: "ops_followup_plan", title: "Clear the ops backlog", source: "triage", priority: "medium" }),
      ],
      { now: NOW },
    );
    assert.equal(tasks.length, 2);
    for (const t of tasks) {
      assert.equal(t.status, "queued", "every proposed task must be born queued");
      assert.equal(t.requiredApproval, "Hart");
      // Structurally cannot be an executor-only/approved state.
      assert.ok(!EXECUTOR_ONLY_TASK_STATUSES.includes(t.status));
      // A stamped genesis audit event (no audit = no proposal).
      assert.equal(t.auditEvents.length, 1);
      assert.equal(t.auditEvents[0]!.event, "autonomy:proposed");
      assert.equal(t.auditEvents[0]!.at, NOW);
      assert.equal(t.createdAt, NOW);
      assert.equal(t.updatedAt, NOW);
      assert.equal(t.owner, null);
    }
    // taskType is carried through from the suggestion vocabulary.
    assert.equal(tasks[0]!.taskType, "build_agent_plan");
    assert.equal(tasks[1]!.taskType, "ops_followup_plan");
  });

  it("records the authorizing proposal id when known, honest null otherwise (no fabrication)", () => {
    const a = suggestion({ id: "sg-known" });
    const b = suggestion({ id: "sg-unknown" });
    const tasks = proposeTasksFromSuggestions([a, b], {
      now: NOW,
      authorizingProposalIds: { "sg-known": "prop-123" },
    });
    assert.equal(tasks[0]!.authorizingProposalId, "prop-123");
    assert.equal(tasks[1]!.authorizingProposalId, null);
  });

  it("also proposes from synthesized fleet risks — queued, Hart-required, never laundering confidence", () => {
    const tasks = proposeTasksFromSuggestions([], {
      now: NOW,
      risks: [fleetRisk({ subject: "fitness", confidence: "low", severity: 2 })],
    });
    assert.equal(tasks.length, 1);
    const t = tasks[0]!;
    assert.equal(t.status, "queued");
    assert.equal(t.requiredApproval, "Hart");
    assert.equal(t.authorizingProposalId, null); // synthesized → no single authorizing proposal
    // Honesty: the risk's OWN (already-clamped) band is carried, never upgraded.
    assert.equal(t.payload.confidence, "low");
    assert.equal(t.taskType, "sync_repair_plan");
  });

  it("is deterministic: same inputs ⇒ deep-equal output", () => {
    const args: [SuggestedAction[], { now: string; risks: FleetRisk[] }] = [
      [suggestion()],
      { now: NOW, risks: [fleetRisk()] },
    ];
    const a = proposeTasksFromSuggestions(args[0], args[1]);
    const b = proposeTasksFromSuggestions(args[0], args[1]);
    assert.deepEqual(a, b);
  });
});

describe("autonomy-loop — advanceAutonomously (the floor: refuses all executor-only targets)", () => {
  it("advances a queued task at most to assigned (benign non-executor step)", () => {
    for (const actor of NON_EXECUTOR_ACTORS) {
      const { advanced, refusals } = advanceAutonomously([task("queued")], { now: LATER, actor });
      assert.equal(advanced.length, 1);
      assert.equal(advanced[0]!.status, "assigned", `${actor} should advance queued → assigned`);
      assert.equal(advanced[0]!.updatedAt, LATER);
      // queued → in_progress is the ONLY executor-only target reachable from queued.
      const refusedTargets = refusals.map((r) => r.to);
      assert.deepEqual(refusedTargets, ["in_progress"]);
    }
  });

  it("REFUSES every executor-only target (in_progress/done/failed) — never advances into one", () => {
    // queued → in_progress, in_progress → done, in_progress → failed are the executor-only edges.
    const cases: Array<{ from: AgentTaskStatus; expectRefused: AgentTaskStatus[] }> = [
      { from: "queued", expectRefused: ["in_progress"] },
      { from: "assigned", expectRefused: ["in_progress"] },
      { from: "in_progress", expectRefused: ["done", "failed"] },
    ];
    for (const actor of NON_EXECUTOR_ACTORS) {
      for (const { from, expectRefused } of cases) {
        const { advanced, refusals } = advanceAutonomously([task(from)], { now: LATER, actor });
        const refusedTargets = refusals.map((r) => r.to).sort();
        assert.deepEqual(refusedTargets, [...expectRefused].sort(), `from ${from} as ${actor}`);
        // The floor invariant: the loop must never MOVE a task INTO an executor-only state. A task
        // that STARTED executor-only (the in_progress fixture) may pass through unchanged — that is
        // the input, not the loop creating one. So any executor-only advanced task must be unchanged.
        for (const t of advanced) {
          if (EXECUTOR_ONLY_TASK_STATUSES.includes(t.status)) {
            assert.equal(t.status, from, `the loop never MOVED a task into an executor-only state (from ${from})`);
          }
        }
        // Every refusal cites the executor_only floor.
        for (const r of refusals) {
          assert.match(r.reason, /executor-only/);
        }
      }
    }
  });

  it("the default actor (none supplied) is a NON-executor — still cannot reach an executor state", () => {
    // No actor supplied → defaults to a non-executor surface. From queued it advances only to
    // assigned and REFUSES the lone executor-only target (in_progress), never applying it.
    const { advanced, refusals } = advanceAutonomously([task("queued")], { now: LATER });
    assert.equal(advanced[0]!.status, "assigned");
    assert.ok(!EXECUTOR_ONLY_TASK_STATUSES.includes(advanced[0]!.status));
    assert.deepEqual(refusals.map((r) => r.to), ["in_progress"]);
    assert.match(refusals[0]!.reason, /executor-only/);
  });

  it("is idempotent: an already-assigned (or terminal) task is returned unchanged with no spurious advance", () => {
    for (const status of ["assigned", "done", "failed", "cancelled"] as AgentTaskStatus[]) {
      const t = task(status);
      const { advanced } = advanceAutonomously([t], { now: LATER, actor: "cockpit" });
      assert.equal(advanced[0]!.status, status, `${status} must not be re-advanced`);
    }
    // Running the loop twice from queued reaches assigned, then is a fixed point.
    const once = advanceAutonomously([task("queued")], { now: LATER, actor: "cockpit" });
    const twice = advanceAutonomously(once.advanced, { now: LATER, actor: "cockpit" });
    assert.equal(twice.advanced[0]!.status, "assigned");
  });

  it("is deterministic: same inputs ⇒ deep-equal output", () => {
    const a = advanceAutonomously([task("queued")], { now: LATER, actor: "cockpit" });
    const b = advanceAutonomously([task("queued")], { now: LATER, actor: "cockpit" });
    assert.deepEqual(a, b);
  });
});

describe("autonomy-loop — EXHAUSTIVE floor proof (no loop sequence reaches an executor-only state)", () => {
  it("from EVERY starting status, iterating the loop to a fixed point NEVER yields an executor-only status", () => {
    for (const actor of NON_EXECUTOR_ACTORS) {
      for (const start of ALL_STATUSES) {
        let current = [task(start, `task-${start}`)];
        // Iterate to a fixed point (the loop advances at most one benign step per call, so a
        // handful of iterations is more than enough; cap defensively against any regression).
        for (let i = 0; i < 10; i++) {
          const beforeStatuses = current.map((t) => t.status);
          const { advanced, refusals } = advanceAutonomously(current, { now: LATER, actor });

          // INVARIANT 1 (the floor): the loop NEVER moves a task INTO an executor-only state.
          // A fixture that STARTS executor-only is allowed to stay there unchanged (the loop did
          // not produce it); what is forbidden is the loop ADVANCING a non-executor task into one.
          advanced.forEach((t, idx) => {
            const wasExecutorOnly = EXECUTOR_ONLY_TASK_STATUSES.includes(beforeStatuses[idx]!);
            if (EXECUTOR_ONLY_TASK_STATUSES.includes(t.status)) {
              assert.ok(
                wasExecutorOnly && t.status === beforeStatuses[idx],
                `floor breached: loop moved '${beforeStatuses[idx]}' INTO executor-only '${t.status}' (start '${start}' as '${actor}')`,
              );
            }
          });
          // INVARIANT 2: every executor-only target the loop touched was REFUSED, not applied.
          for (const r of refusals) {
            assert.ok(EXECUTOR_ONLY_TASK_STATUSES.includes(r.to));
          }

          const before = beforeStatuses.join(",");
          const after = advanced.map((t) => t.status).join(",");
          current = advanced;
          if (before === after) break; // fixed point
        }
      }
    }
  });

  it("proposed-then-advanced end to end never crosses the floor", () => {
    const proposed = proposeTasksFromSuggestions(
      [suggestion(), suggestion({ id: "sg-2", title: "Second action" })],
      { now: NOW, risks: [fleetRisk()] },
    );
    // All born queued.
    for (const t of proposed) assert.equal(t.status, "queued");
    // Drive the loop repeatedly; the strongest it can do is assigned.
    let current = proposed;
    for (let i = 0; i < 5; i++) {
      const { advanced } = advanceAutonomously(current, { now: LATER, actor: "cockpit" });
      for (const t of advanced) {
        assert.ok(!EXECUTOR_ONLY_TASK_STATUSES.includes(t.status));
        assert.equal(t.requiredApproval, "Hart");
      }
      current = advanced;
    }
    // Final state: every task is at most 'assigned' — the human-approval floor is intact.
    for (const t of current) {
      assert.ok(["queued", "assigned"].includes(t.status), `expected queued|assigned, got ${t.status}`);
    }
  });

  it("the loop has NO approve concept and NO executor actor path (type-level floor)", () => {
    // AutonomyActor excludes "executor" at the TYPE level. This line documents the guarantee:
    // assigning "executor" to an AutonomyActorMustNotBeExecutor would be a COMPILE error.
    const allowed: AutonomyActor[] = ["cockpit", "worker"];
    // @ts-expect-error — "executor" is structurally excluded from AutonomyActor (the floor).
    const barred: AutonomyActor = "executor";
    void barred;
    assert.deepEqual(allowed, ["cockpit", "worker"]);
  });
});
