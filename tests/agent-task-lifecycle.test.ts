/**
 * tests/agent-task-lifecycle.test.ts
 *
 * The typed-task spine — PURE, fail-closed lifecycle for `AgentTask`. Tests assert:
 *   - the allowed-transition map matches the documented lifecycle exactly;
 *   - canTransition / applyTransition ALLOW each legal transition and REFUSE each illegal
 *     one with a NAMED denial — never throwing-open;
 *   - executor-only states (in_progress/done/failed) cannot be set by a non-executor
 *     actor (cockpit/worker) — mirrors the proposal-types EXECUTOR_ONLY guard;
 *   - terminal states (done/failed/cancelled) refuse any outbound transition;
 *   - determinism: same input ⇒ deep-equal; input is never mutated.
 *
 * Fully HERMETIC: no env, no network, no fs, no clock — `now` is injected.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_TASK_TRANSITIONS,
  EXECUTOR_ONLY_TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  type AgentTask,
  type AgentTaskActor,
  type AgentTaskStatus,
} from "../src/tasks/agent-task-types.js";
import {
  applyTransition,
  canTransition,
  isExecutorOnlyStatus,
  isTerminalStatus,
} from "../src/tasks/agent-task-lifecycle.js";

const NOW = "2026-06-09T12:00:00.000Z";
const LATER = "2026-06-09T13:00:00.000Z";

const ALL_STATUSES: AgentTaskStatus[] = [
  "queued",
  "assigned",
  "in_progress",
  "done",
  "failed",
  "cancelled",
];

/** A minimal valid task fixture at a given status. */
function makeTask(status: AgentTaskStatus): AgentTask {
  return {
    id: "task-fixture-1",
    domain: "factory",
    owner: null,
    taskType: "agent_creation_plan",
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

describe("agent-task lifecycle (typed-task spine)", () => {
  it("allowed-transition map matches the documented lifecycle", () => {
    assert.deepEqual(ALLOWED_TASK_TRANSITIONS, {
      queued: ["assigned", "in_progress", "cancelled"],
      assigned: ["in_progress", "cancelled"],
      in_progress: ["done", "failed", "cancelled"],
      done: [],
      failed: [],
      cancelled: [],
    });
  });

  it("declares the executor-only and terminal status sets", () => {
    assert.deepEqual([...EXECUTOR_ONLY_TASK_STATUSES], ["in_progress", "done", "failed"]);
    assert.deepEqual([...TERMINAL_TASK_STATUSES], ["done", "failed", "cancelled"]);
    for (const s of ["in_progress", "done", "failed"] as AgentTaskStatus[]) {
      assert.equal(isExecutorOnlyStatus(s), true);
    }
    for (const s of ["queued", "assigned", "cancelled"] as AgentTaskStatus[]) {
      assert.equal(isExecutorOnlyStatus(s), false);
    }
    for (const s of ["done", "failed", "cancelled"] as AgentTaskStatus[]) {
      assert.equal(isTerminalStatus(s), true);
    }
  });

  it("canTransition ALLOWS every legal transition (executor actor) and never throws", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALLOWED_TASK_TRANSITIONS[from]) {
        const r = canTransition(from, to, "executor");
        assert.equal(r.allowed, true, `expected ${from} → ${to} allowed`);
        assert.equal(r.denial, null);
      }
    }
  });

  it("canTransition REFUSES every illegal transition with a named denial", () => {
    for (const from of ALL_STATUSES) {
      const legal = new Set<AgentTaskStatus>(ALLOWED_TASK_TRANSITIONS[from]);
      for (const to of ALL_STATUSES) {
        if (from === to) continue; // self-transition checked separately
        if (legal.has(to)) continue;
        const r = canTransition(from, to, "executor");
        assert.equal(r.allowed, false, `expected ${from} → ${to} refused`);
        assert.ok(r.denial, `expected a named denial for ${from} → ${to}`);
        assert.ok(["from_terminal", "illegal_transition"].includes(r.denial!));
        assert.ok(r.reason.length > 0);
      }
    }
  });

  it("refuses a no-op self-transition with a named denial", () => {
    const r = canTransition("queued", "queued", "executor");
    assert.equal(r.allowed, false);
    assert.equal(r.denial, "noop_self_transition");
  });

  it("refuses ALL outbound transitions from a terminal state (fail-closed)", () => {
    for (const term of TERMINAL_TASK_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (to === term) continue;
        const r = canTransition(term, to, "executor");
        assert.equal(r.allowed, false, `${term} → ${to} must be refused`);
        assert.equal(r.denial, "from_terminal");
      }
    }
  });

  it("EXECUTOR-ONLY states cannot be set by a non-executor actor", () => {
    const nonExecutors: AgentTaskActor[] = ["cockpit", "worker"];
    // queued → in_progress is a LEGAL transition, but executor-only by ACTOR.
    for (const actor of nonExecutors) {
      const r = canTransition("queued", "in_progress", actor);
      assert.equal(r.allowed, false, `${actor} must not set in_progress`);
      assert.equal(r.denial, "executor_only");
      // in_progress → done / failed likewise denied for non-executors.
      const done = canTransition("in_progress", "done", actor);
      assert.equal(done.allowed, false);
      assert.equal(done.denial, "executor_only");
    }
    // The executor itself MAY set them.
    assert.equal(canTransition("queued", "in_progress", "executor").allowed, true);
    assert.equal(canTransition("in_progress", "done", "executor").allowed, true);
  });

  it("a non-executor MAY still queue/assign/cancel (read-only surface keeps its powers)", () => {
    assert.equal(canTransition("queued", "assigned", "cockpit").allowed, true);
    assert.equal(canTransition("queued", "cancelled", "worker").allowed, true);
    assert.equal(canTransition("assigned", "cancelled", "cockpit").allowed, true);
    // but cancelling FROM in_progress is allowed for a non-executor too (cancel is not executor-only)
    assert.equal(canTransition("in_progress", "cancelled", "cockpit").allowed, true);
  });

  it("applyTransition advances status, appends an audit event, sets updatedAt, never mutates input", () => {
    const task = makeTask("queued");
    const frozen = JSON.parse(JSON.stringify(task)); // snapshot for mutation check
    const res = applyTransition(task, "assigned", { now: LATER, actor: "cockpit", detail: "routed to factory" });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.task.status, "assigned");
    assert.equal(res.task.updatedAt, LATER);
    assert.equal(res.task.auditEvents.length, 1);
    assert.equal(res.task.auditEvents[0]!.event, "transition:queued->assigned");
    assert.equal(res.task.auditEvents[0]!.at, LATER);
    assert.equal(res.task.auditEvents[0]!.detail, "routed to factory");
    // input untouched
    assert.deepEqual(task, frozen);
  });

  it("applyTransition REFUSES an illegal transition and returns the UNCHANGED task (never throws)", () => {
    const task = makeTask("done"); // terminal
    const res = applyTransition(task, "queued", { now: LATER, actor: "executor" });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.denial, "from_terminal");
    assert.equal(res.task, task); // exact same reference — unchanged
    assert.equal(res.task.status, "done");
    assert.equal(res.task.auditEvents.length, 0);
  });

  it("applyTransition REFUSES an executor-only target for a non-executor actor", () => {
    const task = makeTask("queued");
    const res = applyTransition(task, "in_progress", { now: LATER, actor: "worker" });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.denial, "executor_only");
    assert.equal(res.task.status, "queued");
  });

  it("is deterministic: same input ⇒ deep-equal output", () => {
    const a = applyTransition(makeTask("queued"), "assigned", { now: NOW, actor: "cockpit" });
    const b = applyTransition(makeTask("queued"), "assigned", { now: NOW, actor: "cockpit" });
    assert.deepEqual(a, b);
  });

  it("happy-path full lifecycle: queued → assigned → in_progress → done", () => {
    let task = makeTask("queued");
    const s1 = applyTransition(task, "assigned", { now: NOW, actor: "cockpit" });
    assert.equal(s1.ok, true);
    task = (s1 as { ok: true; task: AgentTask }).task;
    const s2 = applyTransition(task, "in_progress", { now: NOW, actor: "executor" });
    assert.equal(s2.ok, true);
    task = (s2 as { ok: true; task: AgentTask }).task;
    const s3 = applyTransition(task, "done", { now: NOW, actor: "executor" });
    assert.equal(s3.ok, true);
    task = (s3 as { ok: true; task: AgentTask }).task;
    assert.equal(task.status, "done");
    assert.equal(task.auditEvents.length, 3);
  });
});
