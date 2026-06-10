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
import { executiveMemory, type MemorySnapshot } from "../src/awareness/executive-memory.js";
import type { FreshnessReport } from "../src/cockpit/freshness-surface.js";
import type { ProposalQueueItem } from "../src/cockpit/proposals/proposal-types.js";
import type { WolverineReport, WolverineFinding, SystemVerdict } from "../src/wolverine/wolverine-types.js";

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

// ── Knowledge-loop ingestion: Wolverine findings + executive-memory trends ──────
function finding(over: Partial<WolverineFinding> = {}): WolverineFinding {
  return {
    id: "f1",
    category: "unsafe_flag",
    severity: "critical",
    title: "ALLOW_EXEC_CLICKUP is enabled",
    evidence: "Flag is set to true in the environment.",
    recommendedFix: "Disarm the execution flag.",
    blastRadius: "Live ClickUp writes.",
    rollbackPath: "Unset the flag.",
    approvalRequired: true,
    confidence: "high",
    freshness: NOW,
    source: "unsafe-flags",
    ...over,
  } as WolverineFinding;
}
function wolverineReport(findings: WolverineFinding[], verdict: SystemVerdict = "RED"): WolverineReport {
  return {
    generatedAt: NOW,
    verdict,
    verdictReason: "test",
    findingCount: findings.length,
    bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    topRisks: findings,
    repairQueue: findings,
    note: "test report",
  };
}
/** Build a history where "ops stale" recurs and risk_count rises, via the REAL memory engine. */
function risingMemory() {
  const dates = ["2026-05-20", "2026-05-25", "2026-05-30", "2026-06-04", "2026-06-07"];
  const riskCounts = [1, 1, 2, 3, 4];
  const history: MemorySnapshot[] = dates.map((d, i) => ({
    at: `${d}T00:00:00Z`,
    riskSubjects: ["ops stale"],
    driftSubjects: [],
    opportunitySubjects: [],
    blindSpotSubjects: [],
    metrics: [{ key: "risk_count", value: riskCounts[i] }],
  }));
  return executiveMemory(history, { now: NOW });
}

describe("prophet forecast — knowledge-loop ingestion", () => {
  it("projects consequence-of-inaction from a critical Wolverine finding → high, now", () => {
    const r = forecast({ now: NOW, wolverine: wolverineReport([finding()]) });
    const c = r.consequences.find((x) => x.subject.includes("ALLOW_EXEC_CLICKUP"))!;
    assert.ok(c, "names the finding");
    assert.equal(c.severity, "high");
    assert.equal(c.horizon, "now");
    assert.match(c.projection, /mutation floor stays open/);
    assert.equal(c.preventedBy, "Disarm the execution flag.");
    assert.equal(c.basis, "Flag is set to true in the environment.");
    assert.equal(r.verdict, "urgent");
    assert.ok(r.scanned.includes("wolverine"));
  });

  it("maps the finding CATEGORY to the right consequence phrasing + horizon", () => {
    const r = forecast({ now: NOW, wolverine: wolverineReport([finding({ category: "git_hygiene", severity: "high", title: "12 uncommitted files" })], "AMBER") });
    const c = r.consequences.find((x) => x.subject.includes("uncommitted"))!;
    assert.match(c.projection, /one disk loss away/);
    assert.equal(c.horizon, "days");
    assert.equal(c.severity, "high");
  });

  it("projects a recurring memory pattern as a hardening standing condition (week+)", () => {
    const r = forecast({ now: NOW, memory: risingMemory() });
    const c = r.consequences.find((x) => x.subject === "recurring: ops stale")!;
    assert.ok(c, "surfaces the recurring pattern");
    assert.equal(c.horizon, "week+");
    assert.equal(c.severity, "high"); // recurred ≥4×
    assert.match(c.projection, /standing condition/);
    assert.ok(r.scanned.includes("executive memory"));
  });

  it("projects a rising problem-count trend as accumulation (days)", () => {
    const r = forecast({ now: NOW, memory: risingMemory() });
    const c = r.consequences.find((x) => x.subject === "trend: risk_count")!;
    assert.ok(c, "surfaces the rising trend");
    assert.equal(c.severity, "medium");
    assert.equal(c.horizon, "days");
    assert.match(c.projection, /accumulating problems faster/);
  });

  it("flags compounding when the immune system is RED AND problems are rising", () => {
    const r = forecast({ now: NOW, wolverine: wolverineReport([finding()], "RED"), memory: risingMemory() });
    const compound = r.consequences.find((x) => x.subject === "system" && /immune system is RED/.test(x.projection))!;
    assert.ok(compound, "surfaces the RED+rising compounding consequence");
    assert.equal(compound.severity, "high");
    assert.equal(compound.horizon, "now");
    assert.equal(r.verdict, "urgent");
  });

  it("is honest about absence — names wolverine/memory as blind spots when not supplied", () => {
    const r = forecast({ now: NOW });
    assert.ok(r.blindSpots.some((b) => /wolverine/.test(b)));
    assert.ok(!r.scanned.includes("wolverine"));
    assert.ok(!r.scanned.includes("executive memory"));
  });

  it("does NOT project from insufficient memory history (honesty floor)", () => {
    const thin = executiveMemory(
      [{ at: "2026-06-07T00:00:00Z", riskSubjects: ["ops stale"], driftSubjects: [], opportunitySubjects: [], blindSpotSubjects: [], metrics: [] }],
      { now: NOW },
    );
    assert.equal(thin.status, "insufficient_history");
    const r = forecast({ now: NOW, memory: thin });
    assert.ok(!r.consequences.some((c) => c.subject.startsWith("recurring:") || c.subject.startsWith("trend:")));
    assert.ok(!r.scanned.includes("executive memory")); // status !== ok ⇒ not scanned
  });

  it("projects latent-gap + no-clean-path consequences from Beezulbub capability scouts", () => {
    const r = forecast({
      now: NOW,
      capabilityScouts: [
        { target: "markdown_editor", mode: "live", candidateCount: 5, topCandidate: "vditor", topLicense: "AGPL-3.0", topStaleRisk: "low", riskyTopLicense: true, staleTop: false },
        { target: "data_grid", mode: "live", candidateCount: 3, topCandidate: "ag-grid", topLicense: "MIT", topStaleRisk: "low", riskyTopLicense: false, staleTop: false },
      ],
    });
    const latent = r.consequences.find((c) => c.subject === "capability absorption")!;
    assert.ok(latent, "latent-gap consequence");
    assert.equal(latent.horizon, "week+");
    const risk = r.consequences.find((c) => c.subject === "absorption risk")!;
    assert.ok(risk, "no-clean-path consequence");
    assert.match(risk.basis, /markdown_editor/);
    assert.ok(r.scanned.includes("capability scouts"));
  });

  it("stays backward compatible — omitting the new inputs is byte-identical", () => {
    const base = { now: NOW, perception: perceive({ now: NOW, freshness: fresh([dom("ops", "stale")]) }) };
    const a = forecast(base);
    const b = forecast({ ...base, wolverine: null, memory: null });
    assert.deepEqual(a, b);
  });
});
