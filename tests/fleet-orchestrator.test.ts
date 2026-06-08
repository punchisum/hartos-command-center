/**
 * tests/fleet-orchestrator.test.ts — Phase F4.
 *
 * The deterministic fleet orchestrator: it commits each routed task to ONE agent
 * (least-loaded capable, under capacity), sequences by dependency (refresh/repair
 * before followup/research/review), and is HONEST about what it can't place —
 * `needs_agent` (a capability gap → build one) vs `blocked_capacity` (capable agents
 * full → scale them). Fixtures are built from the real planner + perceiver so the
 * test exercises the true upstream shapes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { orchestrateFleet, summarizeFleetPlan } from "../src/fleet/orchestrator.js";
import { collectFleetTasks } from "../src/fleet/fleet-work.js";
import { FLEET_REGISTRY, type AgentRegistration } from "../src/fleet/fleet-os.js";
import { planResearch } from "../src/research/research-planner.js";
import { perceive } from "../src/rinnegan/perception.js";
import type { FreshnessReport } from "../src/cockpit/freshness-surface.js";
import type { ProposalQueueItem } from "../src/cockpit/proposals/proposal-types.js";

const NOW = "2026-06-08T12:00:00Z";
function dom(domain: string, state: string) {
  return { domain, state, lastUpdated: "2026-06-05", reason: "r" };
}
function fresh(domains: ReturnType<typeof dom>[], clickupStale = false): FreshnessReport {
  return { verdict: "amber", verdictReason: "x", domains, clickup: { stale: clickupStale, lastImportAt: null }, staleReason: "", safeNextStep: "x" } as unknown as FreshnessReport;
}
function prop(over: Partial<ProposalQueueItem>): ProposalQueueItem {
  return { id: "p", domain: "system", actionType: "review_plan", title: "t", status: "draft", createdAt: NOW, ...over } as unknown as ProposalQueueItem;
}

describe("fleet orchestrator (Phase F4)", () => {
  it("is idle when there is no work", () => {
    const plan = orchestrateFleet(collectFleetTasks({}));
    assert.equal(plan.verdict, "idle");
    assert.deepEqual(plan.assignments, []);
    assert.deepEqual(plan.deferred, []);
    assert.match(plan.reconciliation.join(" "), /No open work/);
  });

  it("assigns work within capacity → verdict ready, per-agent load tracked", () => {
    // ops stale (→ refresh) + aging proposals (→ followup). Both route to ops
    // (capabilities refresh + ops, capacity 3) → both placed, nothing deferred.
    const perception = perceive({
      now: NOW,
      freshness: fresh([dom("ops", "stale")]),
      proposals: [prop({ status: "pending_approval", createdAt: "2026-06-01T00:00:00Z" })],
    });
    const plan = orchestrateFleet(collectFleetTasks({ perception }));
    assert.equal(plan.verdict, "ready");
    assert.equal(plan.deferred.length, 0);
    const ops = plan.perAgent.find((a) => a.id === "ops")!;
    assert.equal(ops.assigned, 2);
    assert.ok(ops.assigned <= ops.capacity);
  });

  it("sequences refresh/repair (wave 1) before followup/research (wave 2)", () => {
    const perception = perceive({
      now: NOW,
      freshness: fresh([dom("ops", "stale")]), // critical staleness → refresh (tier 0)
      proposals: [prop({ status: "pending_approval", createdAt: "2026-06-01T00:00:00Z" })], // backlog → followup (tier 1)
    });
    const plan = orchestrateFleet(collectFleetTasks({ perception }));
    const refresh = plan.assignments.find((a) => a.task.type === "refresh")!;
    const followup = plan.assignments.find((a) => a.task.type === "followup")!;
    assert.equal(refresh.order, 1, "refresh runs in wave 1");
    assert.equal(followup.order, 2, "followup runs in wave 2");
    assert.match(plan.reconciliation.join(" "), /wave 1 .* before wave 2/);
  });

  it("load-balances across equally-capable agents (least-loaded first)", () => {
    const TWO_RESEARCH: AgentRegistration[] = [
      { id: "r1", name: "R1", icon: "🔬", kind: "core", capabilities: ["research"], capacity: 2 },
      { id: "r2", name: "R2", icon: "🔬", kind: "core", capabilities: ["research"], capacity: 2 },
    ];
    // "what is a vector database" → definition shape → 4 research sub-questions;
    // 2 agents × capacity 2 = 4 slots → 2 each, balanced, nothing deferred.
    const work = collectFleetTasks({ plan: planResearch("what is a vector database"), registry: TWO_RESEARCH });
    const plan = orchestrateFleet(work, { registry: TWO_RESEARCH });
    assert.equal(plan.verdict, "ready");
    assert.equal(plan.perAgent.find((a) => a.id === "r1")!.assigned, 2);
    assert.equal(plan.perAgent.find((a) => a.id === "r2")!.assigned, 2);
  });

  it("defers over-capacity work as blocked_capacity (scale-the-agent signal)", () => {
    // comparison shape → 5 research sub-questions; research capacity 2 → 2 placed, 3 deferred.
    const work = collectFleetTasks({ plan: planResearch("compare Postgres and SQLite for an edge app") });
    const plan = orchestrateFleet(work);
    assert.equal(plan.verdict, "blocked_capacity");
    assert.equal(plan.assignments.length, 2);
    assert.equal(plan.deferred.length, 3);
    assert.ok(plan.deferred.every((d) => d.reason === "capacity"));
    assert.equal(plan.perAgent.find((a) => a.id === "research")!.assigned, 2);
    assert.match(plan.reconciliation.join(" "), /deferred for capacity \(research\)/); // capability name intact, not shredded into chars
  });

  it("defers unhandleable work as needs_agent (grow-the-fleet-by-building signal)", () => {
    // ops unavailable → blind_spot → repair task; strip "repair" from the fleet → no handler.
    const noRepair = FLEET_REGISTRY.map((r) => ({ ...r, capabilities: r.capabilities.filter((c) => c !== "repair") }));
    const work = collectFleetTasks({ perception: perceive({ now: NOW, freshness: fresh([dom("ops", "unavailable")]) }), registry: noRepair });
    const plan = orchestrateFleet(work, { registry: noRepair });
    assert.equal(plan.verdict, "needs_agent");
    assert.ok(plan.deferred.some((d) => d.reason === "capability_gap" && d.task.targetCapability === "repair"));
    assert.match(plan.reconciliation.join(" "), /build an agent/);
  });

  it("a capability gap outranks a capacity block in the verdict", () => {
    // research capacity 1 + repair stripped: research tasks overflow capacity AND the
    // repair task has no handler → both deferral reasons present → needs_agent wins.
    const reg = FLEET_REGISTRY.map((r) => ({
      ...r,
      capabilities: r.capabilities.filter((c) => c !== "repair"),
      capacity: r.id === "research" ? 1 : r.capacity,
    }));
    const work = collectFleetTasks({
      plan: planResearch("compare Postgres and SQLite for an edge app"),
      perception: perceive({ now: NOW, freshness: fresh([dom("ops", "unavailable")]) }),
      registry: reg,
    });
    const plan = orchestrateFleet(work, { registry: reg });
    assert.ok(plan.deferred.some((d) => d.reason === "capacity"));
    assert.ok(plan.deferred.some((d) => d.reason === "capability_gap"));
    assert.equal(plan.verdict, "needs_agent");
  });

  it("is deterministic and summarizes honestly", () => {
    const work = collectFleetTasks({
      plan: planResearch("compare Postgres and SQLite for an edge app"),
      perception: perceive({ now: NOW, freshness: fresh([dom("ops", "stale")]) }),
    });
    assert.deepEqual(orchestrateFleet(work), orchestrateFleet(work));
    assert.match(summarizeFleetPlan(orchestrateFleet(work)), /Orchestration (READY|BLOCKED_CAPACITY|NEEDS_AGENT|IDLE) —/);
  });
});
