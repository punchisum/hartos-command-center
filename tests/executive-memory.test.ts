/**
 * tests/executive-memory.test.ts
 *
 * Executive Memory sprint — benchmark scenarios for the pure memory layer that turns a
 * supplied snapshot history into recurring patterns, trends, lessons, and decision memory.
 * Covers: recurring-pattern detection, trend detection, lesson generation, insufficient-
 * history honesty, pruning, ranking, and snapshot extraction.
 *
 * Hermetic + deterministic: hand-built snapshots, literal `now`, no I/O.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  executiveMemory,
  snapshotFromBrief,
  pruneSnapshots,
  historicalContextFor,
  type MemorySnapshot,
} from "../src/awareness/executive-memory.js";
import { strategicAwareness, type StrategicBrief } from "../src/awareness/strategic-awareness.js";

const NOW = "2026-06-09T12:00:00.000Z";
function daysAgo(n: number): string {
  return new Date(Date.parse(NOW) - n * 24 * 60 * 60 * 1000).toISOString();
}
function snap(at: string, over: Partial<MemorySnapshot> = {}): MemorySnapshot {
  return {
    at,
    riskSubjects: [],
    driftSubjects: [],
    opportunitySubjects: [],
    blindSpotSubjects: [],
    metrics: [],
    ...over,
  };
}

describe("executive memory — honesty floor (Part H)", () => {
  it("FAILURE: fewer than minHistory snapshots → INSUFFICIENT_HISTORY, empty lists", () => {
    const m = executiveMemory([snap(daysAgo(1)), snap(daysAgo(2))], { now: NOW });
    assert.equal(m.status, "insufficient_history");
    assert.equal(m.recurringPatterns.length, 0);
    assert.equal(m.lessons.length, 0);
    assert.match(m.note, /INSUFFICIENT_HISTORY/);
  });

  it("WEAK: enough snapshots but nothing repeats → ok, no fabricated patterns", () => {
    const m = executiveMemory(
      [
        snap(daysAgo(3), { riskSubjects: ["unique a"] }),
        snap(daysAgo(2), { riskSubjects: ["unique b"] }),
        snap(daysAgo(1), { riskSubjects: ["unique c"] }),
      ],
      { now: NOW },
    );
    assert.equal(m.status, "ok");
    assert.equal(m.recurringPatterns.length, 0, "single occurrences are not memories");
    assert.match(m.note, /nothing repeated enough/i);
  });
});

describe("executive memory — recurring pattern detection (Part C)", () => {
  it("EXCELLENT: a risk appearing 4× becomes a ranked recurring pattern with evidence", () => {
    const hist = [
      snap(daysAgo(40), { riskSubjects: ["ops stale", "noise once"] }),
      snap(daysAgo(30), { riskSubjects: ["ops stale"] }),
      snap(daysAgo(20), { riskSubjects: ["ops stale"] }),
      snap(daysAgo(5), { riskSubjects: ["ops stale"] }),
    ];
    const m = executiveMemory(hist, { now: NOW });
    assert.equal(m.status, "ok");
    const p = m.recurringPatterns.find((x) => x.subject === "ops stale");
    assert.ok(p, "recurring risk detected");
    assert.equal(p!.occurrences, 4);
    assert.equal(p!.kind, "risk");
    assert.match(p!.evidence, /4× in the last 60 days/);
    // the single-occurrence "noise once" must NOT become a pattern
    assert.ok(!m.recurringPatterns.some((x) => x.subject === "noise once"));
  });

  it("RANKING: a more-frequent, more-recent pattern outranks a rarer/older one", () => {
    const hist = [
      snap(daysAgo(55), { driftSubjects: ["old drift"] }),
      snap(daysAgo(50), { driftSubjects: ["old drift"] }),
      snap(daysAgo(4), { driftSubjects: ["hot drift"] }),
      snap(daysAgo(3), { driftSubjects: ["hot drift"] }),
      snap(daysAgo(1), { driftSubjects: ["hot drift"] }),
    ];
    const m = executiveMemory(hist, { now: NOW });
    assert.equal(m.recurringPatterns[0]!.subject, "hot drift", "recent + frequent ranks first");
  });
});

describe("executive memory — trend detection (Part D)", () => {
  it("EXCELLENT: a rising metric across ≥3 snapshots is reported as rising with evidence", () => {
    const hist = [
      snap(daysAgo(5), { metrics: [{ key: "risk_count", value: 1 }] }),
      snap(daysAgo(3), { metrics: [{ key: "risk_count", value: 3 }] }),
      snap(daysAgo(1), { metrics: [{ key: "risk_count", value: 5 }] }),
    ];
    const m = executiveMemory(hist, { now: NOW });
    const t = m.trends.find((x) => x.metric === "risk_count");
    assert.ok(t, "trend detected");
    assert.equal(t!.direction, "rising");
    assert.match(t!.evidence, /risk_count/);
  });

  it("a metric with <3 points yields no trend (no invented direction)", () => {
    const hist = [
      snap(daysAgo(3), { metrics: [{ key: "x", value: 1 }] }),
      snap(daysAgo(2), { riskSubjects: ["r"] }),
      snap(daysAgo(1), { riskSubjects: ["r"] }),
    ];
    const m = executiveMemory(hist, { now: NOW });
    assert.ok(!m.trends.some((t) => t.metric === "x"), "sparse metric → no trend");
  });
});

describe("executive memory — lessons (Part E)", () => {
  it("EXCELLENT: a pattern recurring ≥3× yields a descriptive, evidence-linked lesson", () => {
    const hist = [
      snap(daysAgo(30), { opportunitySubjects: ["deload week win"] }),
      snap(daysAgo(20), { opportunitySubjects: ["deload week win"] }),
      snap(daysAgo(10), { opportunitySubjects: ["deload week win"] }),
    ];
    const m = executiveMemory(hist, { now: NOW });
    const l = m.lessons.find((x) => /deload week win/i.test(x.lesson));
    assert.ok(l, "lesson generated from a real recurring pattern");
    assert.ok(l!.sourceSubjects.length > 0, "lesson is linked to source subjects (explainable)");
    assert.match(l!.basis, /Occurred 3×/);
  });

  it("a 2× pattern does NOT generate a lesson (lessons need ≥3 occurrences)", () => {
    const hist = [
      snap(daysAgo(20), { riskSubjects: ["twice only"] }),
      snap(daysAgo(10), { riskSubjects: ["twice only"] }),
      snap(daysAgo(5), { riskSubjects: ["other"] }),
    ];
    const m = executiveMemory(hist, { now: NOW });
    assert.ok(!m.lessons.some((l) => /twice only/i.test(l.lesson)));
  });
});

describe("executive memory — decisions + pruning + extraction", () => {
  it("decision memory is ranked most-recent-first and deduped", () => {
    const d = (at: string, decision: string) => ({ decision, domain: "ops", at, evidence: "e" });
    const hist = [
      snap(daysAgo(10), { riskSubjects: ["a"], decisions: [d(daysAgo(10), "pivot X")] }),
      snap(daysAgo(5), { riskSubjects: ["a"], decisions: [d(daysAgo(5), "escalate Y")] }),
      snap(daysAgo(1), { riskSubjects: ["a"], decisions: [d(daysAgo(5), "escalate Y")] }), // dup
    ];
    const m = executiveMemory(hist, { now: NOW });
    assert.equal(m.decisions.length, 2, "deduped");
    assert.equal(m.decisions[0]!.decision, "escalate Y", "most recent first");
  });

  it("PRUNING: snapshots outside the window are dropped before analysis", () => {
    const hist = [
      snap(daysAgo(90), { riskSubjects: ["ancient"] }), // outside 60d window
      snap(daysAgo(40), { riskSubjects: ["ops stale"] }),
      snap(daysAgo(20), { riskSubjects: ["ops stale"] }),
      snap(daysAgo(5), { riskSubjects: ["ops stale"] }),
    ];
    const pruned = pruneSnapshots(hist, NOW, 60);
    assert.equal(pruned.length, 3, "the 90-day-old snapshot is pruned");
    const m = executiveMemory(hist, { now: NOW });
    assert.ok(!m.recurringPatterns.some((p) => p.subject === "ancient"));
  });

  it("snapshotFromBrief extracts compact subjects + metrics, not prose", () => {
    const brief: StrategicBrief = {
      status: "ok",
      risks: [{ risk: "Ops stale", why: "w", evidence: "e", confidence: "high", suggestedAction: "a" }],
      opportunities: [],
      drift: [{ drift: "Data drift", evidence: "e", impact: "i", suggestedCorrection: "c" }],
      blindSpots: [],
      recommendedFocus: null,
      note: "n",
    };
    const s = snapshotFromBrief(brief, NOW);
    assert.deepEqual(s.riskSubjects, ["ops stale"], "normalized subject only, no prose");
    assert.deepEqual(s.driftSubjects, ["data drift"]);
    assert.ok(s.metrics.some((m) => m.key === "risk_count" && m.value === 1));
    assert.ok(s.metrics.some((m) => m.key === "avg_risk_confidence" && m.value === 3));
  });
});

describe("executive memory — integration with the strategic brief (Part F)", () => {
  it("historicalContextFor annotates a current risk that has recurred", () => {
    const hist = [
      snap(daysAgo(40), { riskSubjects: ["decisions are running on stale data"] }),
      snap(daysAgo(20), { riskSubjects: ["decisions are running on stale data"] }),
      snap(daysAgo(5), { riskSubjects: ["decisions are running on stale data"] }),
    ];
    const m = executiveMemory(hist, { now: NOW });
    const ctx = historicalContextFor("Decisions are running on stale data", m);
    assert.ok(ctx, "history found for the recurring risk");
    assert.match(ctx!, /3×/);
  });

  it("strategicAwareness with history adds recurringPatterns + memoryStatus; without history is unchanged", () => {
    const panel = {
      id: "ops" as const, title: "Ops", status: "detected" as const, detected: true, summary: "",
      fields: [{ key: "triage_risks", label: "Operational risks", value: "Stall risk: 2 blocked AND 3 stale.", status: "ok" as const, confidence: "high" as const }],
      highlights: [], gaps: [], nextAction: "n", missingSetupSteps: [], sources: [], confidence: "high" as const, generatedAt: NOW,
    };
    const withoutHistory = strategicAwareness({ now: NOW, panels: [panel] });
    assert.equal(withoutHistory.memoryStatus, undefined, "no history → no memory section");
    assert.equal(withoutHistory.recurringPatterns, undefined);

    const hist = [
      snap(daysAgo(30), { riskSubjects: ["operational risk in the ops queue"] }),
      snap(daysAgo(15), { riskSubjects: ["operational risk in the ops queue"] }),
      snap(daysAgo(2), { riskSubjects: ["operational risk in the ops queue"] }),
    ];
    const withHistory = strategicAwareness({ now: NOW, panels: [panel], history: hist });
    assert.equal(withHistory.memoryStatus, "ok");
    assert.ok((withHistory.recurringPatterns ?? []).length > 0, "recurring patterns surfaced");
    const annotated = withHistory.risks.find((r) => r.historicalContext);
    assert.ok(annotated, "a live risk gained historical context");
  });
});
