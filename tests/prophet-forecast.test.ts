/**
 * tests/prophet-forecast.test.ts — Phase F5.
 *
 * Prophet's consequence-of-inaction forecast: it projects (never fabricates) what
 * happens if KNOWN issues are left alone — data-rot from stale inputs, accumulation
 * from the orchestrator's deferrals (the capstone link to F4), stalled decisions, and
 * the compounding of stale data + uncleared work. It is honest about scope: it carries
 * perception's blind spots forward as things it explicitly cannot foresee. Fixtures use
 * the real perceiver + orchestrator so the projections sit on true upstream shapes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { forecast, summarizeForecast } from "../src/prophet/forecast.js";
import { perceive } from "../src/rinnegan/perception.js";
import { orchestrateFleet } from "../src/fleet/orchestrator.js";
import { collectFleetTasks } from "../src/fleet/fleet-work.js";
import { FLEET_REGISTRY } from "../src/fleet/fleet-os.js";
import { planResearch } from "../src/research/research-planner.js";
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

describe("prophet forecast (Phase F5)", () => {
  it("projects data-rot from critical staleness → urgent, now", () => {
    const r = forecast({ now: NOW, perception: perceive({ now: NOW, freshness: fresh([dom("ops", "stale")]) }) });
    const c = r.consequences.find((x) => x.subject === "ops")!;
    assert.equal(c.severity, "high");
    assert.equal(c.horizon, "now");
    assert.match(c.projection, /stays wrong until it's refreshed/);
    assert.ok(c.preventedBy.length > 0, "names the preventing action");
    assert.equal(r.verdict, "urgent");
  });

  it("reads orchestrator capability-gap deferrals → build-an-agent consequence (week+)", () => {
    const noRepair = FLEET_REGISTRY.map((rg) => ({ ...rg, capabilities: rg.capabilities.filter((c) => c !== "repair") }));
    const plan = orchestrateFleet(
      collectFleetTasks({ perception: perceive({ now: NOW, freshness: fresh([dom("ops", "unavailable")]) }), registry: noRepair }),
      { registry: noRepair },
    );
    const r = forecast({ now: NOW, plan });
    const c = r.consequences.find((x) => x.subject === "fleet capability")!;
    assert.equal(c.severity, "high");
    assert.equal(c.horizon, "week+");
    assert.match(c.preventedBy, /Build an agent/);
    assert.equal(r.verdict, "degrading", "structural gap accumulates but isn't same-day urgent");
  });

  it("reads capacity deferrals → growing-backlog consequence (days)", () => {
    const plan = orchestrateFleet(collectFleetTasks({ plan: planResearch("compare Postgres and SQLite for an edge app") }));
    const r = forecast({ now: NOW, plan });
    const c = r.consequences.find((x) => x.subject === "fleet capacity")!;
    assert.equal(c.severity, "medium");
    assert.equal(c.horizon, "days");
    assert.match(c.projection, /backlog grows/);
  });

  it("flags compounding when stale data AND deferred work coexist", () => {
    const perception = perceive({ now: NOW, freshness: fresh([dom("ops", "stale")]) }); // stale data
    const plan = orchestrateFleet(collectFleetTasks({ plan: planResearch("compare Postgres and SQLite for an edge app") })); // capacity defers
    const r = forecast({ now: NOW, perception, plan });
    const compound = r.consequences.find((x) => x.subject === "system")!;
    assert.match(compound.projection, /compound/);
    assert.equal(compound.severity, "high");
    assert.equal(r.verdict, "urgent");
  });

  it("projects stalled decisions from aging proposals", () => {
    const r = forecast({ now: NOW, proposals: [prop({ status: "pending_approval", createdAt: "2026-06-01T00:00:00Z" })] });
    const c = r.consequences.find((x) => x.subject === "proposals")!;
    assert.equal(c.severity, "medium");
    assert.match(c.projection, /stalled/);
    assert.equal(r.verdict, "degrading");
  });

  it("is honest when there is nothing to forecast — verdict stable, perception a blind spot", () => {
    const r = forecast({ now: NOW });
    assert.equal(r.verdict, "stable");
    assert.deepEqual(r.consequences, []);
    assert.ok(r.blindSpots.some((b) => /perception/.test(b)));
  });

  it("carries perception's blind spots forward as things it cannot foresee", () => {
    const r = forecast({ now: NOW, perception: perceive({ now: NOW, freshness: fresh([dom("fitness", "unavailable")]) }) });
    assert.ok(r.blindSpots.includes("fitness"));
    assert.ok(r.scanned.includes("perception"));
  });

  it("is deterministic and summarizes honestly", () => {
    const input = { now: NOW, perception: perceive({ now: NOW, freshness: fresh([dom("ops", "stale")]) }) };
    assert.deepEqual(forecast(input), forecast(input));
    assert.match(summarizeForecast(forecast(input)), /Forecast (STABLE|DEGRADING|URGENT) —/);
  });
});
