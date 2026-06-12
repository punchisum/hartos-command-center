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

describe("buildTasksView", () => {
  it("undefined rows ⇒ unavailable, no fabrication", () => {
    const v = buildTasksView(undefined, NOW);
    assert.equal(v.available, false);
    assert.equal(v.tasks.length, 0);
    assert.match(v.note ?? "", /unavailable/i);
  });

  it("maps agent_job rows to tasks with the right stage + agent + verb", () => {
    const v = buildTasksView(
      [
        job("a", "research.brief", "simulated_approved", 1, "research coaching apps"),
        job("b", "claude.execute", "pending_approval", 3, "build crypto agent"),
        job("c", "wolverine.audit", "executed", 30),
        job("d", "beezulbub.hunt", "failed", 5),
      ],
      NOW,
    );
    assert.equal(v.available, true);
    const a = v.tasks.find((t) => t.id === "a")!;
    assert.equal(a.stage, "running");
    assert.equal(a.agent, "Beezulbub");
    assert.equal(a.verb, "researching");
    assert.equal(v.tasks.find((t) => t.id === "b")!.stage, "queued");
    assert.equal(v.tasks.find((t) => t.id === "b")!.agent, "Factory");
    assert.equal(v.tasks.find((t) => t.id === "c")!.stage, "done");
    assert.equal(v.tasks.find((t) => t.id === "d")!.stage, "failed");
  });

  it("ignores non-agent_job rows", () => {
    const v = buildTasksView(
      [{ id: "m", title: "mutate clickup", status: "pending_approval", payload: { actionType: "mutation" } }],
      NOW,
    );
    assert.equal(v.tasks.length, 0);
  });

  it("counts + sorts running first, dismissed last", () => {
    const v = buildTasksView(
      [
        job("done", "report", "executed", 10),
        job("run", "research.brief", "simulated_approved", 2),
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
