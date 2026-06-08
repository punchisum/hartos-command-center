/**
 * tests/fleet-work.test.ts — F-phase depth (shared task layer).
 *
 * Agents PRODUCE typed tasks (research sub-questions, perception repairs), Fleet OS
 * ROUTES them by capability, and collectFleetTasks aggregates + ranks + flags the
 * capability GAPS — the honest "grow the fleet" signal that justifies F4/new agents.
 * Pure + deterministic; uses the real planner + perceiver to build fixtures.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planToTasks, perceptionToTasks, routeTask, collectFleetTasks } from "../src/fleet/fleet-work.js";
import { FLEET_REGISTRY } from "../src/fleet/fleet-os.js";
import { planResearch } from "../src/research/research-planner.js";
import { perceive } from "../src/rinnegan/perception.js";
import type { FreshnessReport } from "../src/cockpit/freshness-surface.js";

const NOW = "2026-06-08T12:00:00Z";
function dom(domain: string, state: string) {
  return { domain, state, lastUpdated: "2026-06-05", reason: "r" };
}
function fresh(domains: ReturnType<typeof dom>[], clickupStale = false): FreshnessReport {
  return { verdict: "amber", verdictReason: "x", domains, clickup: { stale: clickupStale, lastImportAt: null }, staleReason: "", safeNextStep: "x" } as unknown as FreshnessReport;
}

describe("fleet work — shared task layer (F-depth)", () => {
  it("planToTasks → one routed-ready research task per sub-question", () => {
    const plan = planResearch("should we build a travel concierge product?");
    const tasks = planToTasks(plan);
    assert.equal(tasks.length, plan.subQuestions.length);
    assert.ok(tasks.every((t) => t.type === "research_question" && t.origin === "research" && t.targetCapability === "research"));
  });

  it("perceptionToTasks → repair/refresh/followup with severity-mapped priority", () => {
    const report = perceive({ now: NOW, freshness: fresh([dom("ops", "stale")]) }); // ops stale = critical staleness
    const refresh = perceptionToTasks(report).find((t) => t.type === "refresh")!;
    assert.equal(refresh.targetCapability, "refresh");
    assert.equal(refresh.priority, "high");
    assert.equal(refresh.origin, "rinnegan");
  });

  it("routeTask matches capabilities; an unmatched capability is unrouted", () => {
    const research = planToTasks(planResearch("research X for the team"))[0]!;
    assert.deepEqual(routeTask(research).handlers, ["research"]);
    const refresh = perceptionToTasks(perceive({ now: NOW, freshness: fresh([dom("ops", "stale")]) })).find((t) => t.type === "refresh")!;
    assert.ok(routeTask(refresh).handlers.includes("ops"));
    assert.equal(routeTask({ ...research, targetCapability: "legal" }).routed, false);
  });

  it("collectFleetTasks aggregates, routes, and priority-ranks", () => {
    const plan = planResearch("compare Postgres and SQLite for an edge app");
    const perception = perceive({ now: NOW, freshness: fresh([dom("ops", "stale"), dom("fitness", "unavailable")], true) });
    const work = collectFleetTasks({ plan, perception });
    assert.ok(work.open > 0);
    assert.equal(work.tasks[0]!.task.priority, "high", "highest priority first");
    assert.ok(work.tasks.some((t) => t.task.origin === "research" && t.routed));
    assert.ok((work.byCapability["research"] ?? 0) >= 1);
  });

  it("flags a capability GAP when no agent can handle a needed task (grow-the-fleet signal)", () => {
    const perception = perceive({ now: NOW, freshness: fresh([dom("ops", "unavailable")]) }); // → repair task
    const noRepair = FLEET_REGISTRY.map((r) => ({ ...r, capabilities: r.capabilities.filter((c) => c !== "repair") }));
    const work = collectFleetTasks({ perception, registry: noRepair });
    assert.ok(work.unrouted >= 1);
    assert.ok(work.gaps.includes("repair"));
  });

  it("is deterministic", () => {
    const plan = planResearch("how to deploy a worker");
    const p = perceive({ now: NOW, freshness: fresh([dom("ops", "stale")]) });
    assert.deepEqual(collectFleetTasks({ plan, perception: p }), collectFleetTasks({ plan, perception: p }));
  });
});
