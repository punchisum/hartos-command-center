/**
 * tests/tasks-view.test.ts — the Live Operations view (pure projection of the job spine).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTasksView, ageLabel, type TaskSourceRow } from "../src/cockpit/tasks-view.js";

const NOW = "2026-06-12T12:00:00.000Z";
const ago = (m: number) => new Date(Date.parse(NOW) - m * 60000).toISOString();

function job(id: string, kind: string, status: string, mins: number, title = id): TaskSourceRow {
  return { id, title, status, domain: "system", updatedAt: ago(mins), payload: { actionType: "agent_job", proposedPayload: { jobKind: kind } } };
}

/** A plan-type row (council_plan / build_agent_plan) — these carry NO jobKind. */
function plan(id: string, actionType: string, status: string, mins: number, title = id): TaskSourceRow {
  return { id, title, status, domain: "system", updatedAt: ago(mins), payload: { actionType } };
}

describe("buildTasksView", () => {
  it("undefined rows ⇒ unavailable, no fabrication", () => {
    const v = buildTasksView(undefined, NOW);
    assert.equal(v.available, false);
    assert.equal(v.tasks.length, 0);
    assert.match(v.note ?? "", /unavailable/i);
  });

  it("NEVER throws: a non-array rows value degrades to unavailable (would crash the v5 render)", () => {
    // A malformed RPC could hand back a number / object / single un-arrayed row.
    assert.doesNotThrow(() => buildTasksView(123 as unknown as TaskSourceRow[], NOW));
    assert.equal(buildTasksView(123 as unknown as TaskSourceRow[], NOW).available, false);
    assert.equal(buildTasksView({} as unknown as TaskSourceRow[], NOW).available, false);
  });

  it("NEVER throws: a null/non-object element inside rows is skipped, not dereferenced", () => {
    const v = buildTasksView(
      [null as unknown as TaskSourceRow, 7 as unknown as TaskSourceRow, job("ok", "research.brief", "executing", 1)],
      NOW,
    );
    assert.equal(v.tasks.length, 1);
    assert.equal(v.tasks[0]!.id, "ok");
  });

  it("maps agent_job rows to tasks with the right stage + plain-English label + agent + verb", () => {
    const v = buildTasksView(
      [
        job("a", "research.brief", "executing", 1, "research coaching apps"),
        job("a2", "research.brief", "simulated_approved", 1, "queued research"),
        job("b", "claude.execute", "pending_approval", 3, "build crypto agent"),
        job("c", "wolverine.audit", "executed", 30),
        job("d", "beezulbub.hunt", "failed", 5),
      ],
      NOW,
    );
    assert.equal(v.available, true);
    const a = v.tasks.find((t) => t.id === "a")!;
    assert.equal(a.stage, "running"); // ONLY a genuinely-executing job is "running" — honest lifecycle
    assert.equal(a.stageLabel, "running");
    assert.equal(a.agent, "Research Agent"); // research.brief is the Research Agent's job, not Beezulbub
    assert.equal(a.verb, "researching");
    const a2 = v.tasks.find((t) => t.id === "a2")!;
    assert.equal(a2.stage, "queued"); // approved-but-unclaimed is queued, not fake-running
    assert.equal(a2.stageLabel, "approved — queued");
    assert.equal(v.tasks.find((t) => t.id === "b")!.stage, "queued");
    assert.equal(v.tasks.find((t) => t.id === "b")!.stageLabel, "awaiting your approval");
    assert.equal(v.tasks.find((t) => t.id === "b")!.agent, "Factory");
    assert.equal(v.tasks.find((t) => t.id === "c")!.stage, "done");
    assert.equal(v.tasks.find((t) => t.id === "d")!.stage, "failed");
  });

  it("accepts the HOSTED row shape (top-level actionType/proposedPayload, no payload)", () => {
    const v = buildTasksView(
      [{ id: "hosted", title: "Run research", status: "executing", updatedAt: ago(1), actionType: "agent_job", proposedPayload: { jobKind: "research.brief" } }],
      NOW,
    );
    assert.equal(v.tasks.length, 1, "hosted rows must produce tasks — the old payload-only read left Live Ops empty");
    assert.equal(v.tasks[0]!.stage, "running");
    assert.equal(v.tasks[0]!.agent, "Research Agent");
  });

  it("ignores non-task rows (typed mutations, fitness deltas)", () => {
    const v = buildTasksView(
      [{ id: "m", title: "mutate clickup", status: "pending_approval", payload: { actionType: "mutation" } }],
      NOW,
    );
    assert.equal(v.tasks.length, 0);
  });

  it("tracks an APPROVED council_plan as a queued task (the M&A-council-vanishing bug)", () => {
    const v = buildTasksView(
      [plan("council", "council_plan", "simulated_approved", 2, "M&A council: evaluate target")],
      NOW,
    );
    assert.equal(v.tasks.length, 1, "an approved council proposal must NOT vanish from Live Ops");
    const t = v.tasks[0]!;
    assert.equal(t.stage, "queued");
    assert.equal(t.stageLabel, "approved — queued"); // reuses stageOf — same lifecycle vocabulary
    assert.equal(t.agent, "Council");
    assert.equal(t.kind, "council.plan");
    assert.equal(t.verb, "deliberating");
    assert.equal(t.color, "#A974FF");
    assert.equal(t.title, "M&A council: evaluate target"); // real proposal title is preserved
    assert.equal(v.counts.queued, 1);
  });

  it("tracks a build_agent_plan with agent Factory across its lifecycle", () => {
    const v = buildTasksView(
      [
        plan("build", "build_agent_plan", "executing", 1, "stand up crypto-ops agent"),
        plan("buildq", "build_agent_plan", "pending_approval", 4, "stand up legal agent"),
      ],
      NOW,
    );
    const running = v.tasks.find((t) => t.id === "build")!;
    assert.equal(running.agent, "Factory");
    assert.equal(running.kind, "factory.build");
    assert.equal(running.verb, "building");
    assert.equal(running.color, "#FF2D9E");
    assert.equal(running.stage, "running");
    assert.equal(running.stageLabel, "running");
    const queued = v.tasks.find((t) => t.id === "buildq")!;
    assert.equal(queued.agent, "Factory");
    assert.equal(queued.stage, "queued");
    assert.equal(queued.stageLabel, "awaiting your approval");
  });

  it("accepts the HOSTED row shape for plan-type tasks (top-level actionType, no payload)", () => {
    const v = buildTasksView(
      [{ id: "hc", title: "Council deliberation", status: "simulated_approved", updatedAt: ago(1), actionType: "council_plan" }],
      NOW,
    );
    assert.equal(v.tasks.length, 1, "hosted council rows must produce tasks");
    assert.equal(v.tasks[0]!.agent, "Council");
    assert.equal(v.tasks[0]!.stageLabel, "approved — queued");
  });

  it("counts + sorts running first, dismissed last", () => {
    const v = buildTasksView(
      [
        job("done", "report", "executed", 10),
        job("run", "research.brief", "executing", 2),
        job("rej", "report", "rejected", 1),
        job("q", "claude.execute", "pending_approval", 4),
      ],
      NOW,
    );
    assert.deepEqual(v.counts, { queued: 1, running: 1, done: 1, failed: 0, total: 4 });
    assert.equal(v.tasks[0]!.stage, "running");
    assert.equal(v.tasks[v.tasks.length - 1]!.id, "rej");
  });
});

describe("ageLabel", () => {
  it("formats minutes/hours/days; now for <1m; — for null", () => {
    assert.equal(ageLabel(null, NOW), "—");
    assert.equal(ageLabel(ago(0), NOW), "now");
    assert.equal(ageLabel(ago(5), NOW), "5m");
    assert.equal(ageLabel(ago(150), NOW), "2h");
    assert.equal(ageLabel(ago(60 * 24 * 3), NOW), "3d");
  });
});
