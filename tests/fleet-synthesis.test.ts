/**
 * tests/fleet-synthesis.test.ts — 3-levels-up Level 3, the fleet-intelligence seed.
 *
 * synthesizeFleet composes the THREE read-only fleet brains — the Fleet Brain priority
 * briefing, Rinnegan perception, and Prophet forecast — into ONE cross-agent rollup of the
 * top correlated risks. These tests pin the contract:
 *   • CORRELATION: a subject in briefing + perception ⇒ ONE merged risk listing both sources,
 *     ranked above a single-source risk.
 *   • §19 NO LAUNDERING (the core assertion): a HIGH-confidence briefing item correlated with a
 *     low/stale perception observation ⇒ the merged risk's confidence is the WEAKEST band — never
 *     upgraded by adding a corroborating source.
 *   • HONEST COVERAGE: an absent source (e.g. no forecast) ⇒ named as reduced coverage, no
 *     fabrication, the others still synthesized.
 *   • EMPTY: nothing in ⇒ an honest empty rollup naming the blind spots / absent sources.
 *   • DETERMINISM: same input twice ⇒ deep-equal; ranking stable.
 *
 * Fixtures use the REAL upstream synthesizers (assembleBriefing / perceive / forecast) so the
 * rollup sits on true shapes, not hand-built mocks. No env / network / fs / ambient clock.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { synthesizeFleet } from "../src/fleet/fleet-synthesis.js";
import { assembleBriefing } from "../src/fleet/fleet-brain.js";
import { perceive } from "../src/rinnegan/perception.js";
import { forecast } from "../src/prophet/forecast.js";
import type { FleetSignal, AgentSignal } from "../src/read-models/agent-signal.js";
import type { StateDeltaSignal } from "../src/execution/state-delta.js";
import type { FreshnessReport } from "../src/cockpit/freshness-surface.js";

const NOW = new Date("2026-06-09T12:00:00.000Z");
const NOW_ISO = "2026-06-09T12:00:00Z";

// ─── Fixtures (explicit — no hidden clock reads) ─────────────────────────────────

function signal(over: Partial<AgentSignal> = {}): AgentSignal {
  return {
    verdict: "clear",
    confidence: "high",
    facts: [],
    freshness: "live",
    reason: "all clear",
    nextAction: null,
    approvalNeeded: false,
    ...over,
  };
}
function fleetSignal(id: string, type: FleetSignal["type"], over: Partial<AgentSignal> = {}): FleetSignal {
  return { id, type, signal: signal(over) };
}
function delta(over: Partial<StateDeltaSignal> = {}): StateDeltaSignal {
  return {
    source: "refresh-sync",
    domain: "ops",
    changedEntity: "card XYZ",
    before: {},
    after: {},
    actionType: "ops_followup_plan",
    auditId: "audit-1",
    affectedAgents: ["Ops Agent"],
    freshness: "live",
    ...over,
  };
}
function dom(domain: string, state: string) {
  return { domain, state, lastUpdated: "2026-06-05", reason: "r" };
}
function fresh(domains: ReturnType<typeof dom>[], clickupStale = false): FreshnessReport {
  return {
    verdict: "amber", verdictReason: "x", domains,
    clickup: { stale: clickupStale, lastImportAt: null }, staleReason: "", safeNextStep: "x",
  } as unknown as FreshnessReport;
}

// ─── CORRELATION: one subject in two sources → one merged, higher-ranked risk ─────

describe("fleet-synthesis — correlation", () => {
  it("merges a subject present in briefing + perception into ONE risk with both sources", () => {
    const briefing = assembleBriefing({
      signals: [fleetSignal("ops", "ops", { verdict: "urgent", confidence: "high", freshness: "live" })],
      now: NOW,
    });
    const perception = perceive({ now: NOW_ISO, freshness: fresh([dom("ops", "stale")]) }); // ops critical

    const r = synthesizeFleet({ briefing, perception });
    const ops = r.topRisks.find((x) => x.subject === "ops")!;
    assert.ok(ops, "the ops subject is synthesized");
    assert.deepEqual(ops.sources, ["briefing", "perception"], "both contributing sources are listed");
    assert.ok(ops.why.length > 0, "evidence is composed, never fabricated empty");
  });

  it("ranks a cross-source risk above a single-source risk of the same severity", () => {
    // ops is corroborated (briefing urgent sev3 + perception stale critical sev3); clickup is a
    // single-source critical (sev3) from perception only. Same severity ⇒ corroboration breaks the
    // tie, so the cross-agent ops risk ranks ahead of the single-source clickup risk.
    const briefing = assembleBriefing({
      signals: [fleetSignal("ops", "ops", { verdict: "urgent", confidence: "high", freshness: "live" })],
      now: NOW,
    });
    const perception = perceive({ now: NOW_ISO, freshness: fresh([dom("ops", "stale")], true) }); // clickupStale=true

    const r = synthesizeFleet({ briefing, perception });
    const ops = r.topRisks.find((x) => x.subject === "ops")!;
    const clickup = r.topRisks.find((x) => x.subject === "clickup")!;
    assert.equal(ops.severity, 3);
    assert.equal(clickup.severity, 3, "same severity as ops");
    assert.equal(ops.sources.length, 2, "ops is cross-source corroborated");
    assert.equal(clickup.sources.length, 1, "clickup is single-source");
    assert.ok(
      r.topRisks.indexOf(ops) < r.topRisks.indexOf(clickup),
      "cross-source ops outranks the single-source clickup risk at equal severity",
    );
  });
});

// ─── §19 NO LAUNDERING — the core assertion ──────────────────────────────────────

describe("fleet-synthesis — §19 no confidence laundering", () => {
  it("a HIGH-confidence briefing item correlated with a stale perception observation stays at the WEAKEST band", () => {
    // Briefing: a 'high' confidence ops signal that a STALE delta degrades to 'medium' (fleet-brain §19).
    const briefing = assembleBriefing({
      signals: [fleetSignal("ops", "ops", { verdict: "urgent", confidence: "high", freshness: "live" })],
      deltas: [delta({ domain: "ops", freshness: "stale", auditId: "audit-stale" })],
      now: NOW,
    });
    const opsBriefingItem = briefing.items.find((i) => i.domain === "ops")!;
    assert.notEqual(opsBriefingItem.confidence, "high", "precondition: the briefing already degraded it (§19)");
    assert.equal(opsBriefingItem.freshness, "stale");

    // Correlate with perception's (severity-only, NO-confidence) ops staleness observation.
    const perception = perceive({ now: NOW_ISO, freshness: fresh([dom("ops", "stale")]) });

    const r = synthesizeFleet({ briefing, perception });
    const ops = r.topRisks.find((x) => x.subject === "ops")!;
    // Adding a corroborating source must NOT upgrade confidence past the weakest contributing band.
    assert.notEqual(ops.confidence, "high", "combining sources must never launder confidence up to 'high' (§19)");
    assert.equal(ops.confidence, opsBriefingItem.confidence, "clamped to the briefing's already-degraded band");
    assert.deepEqual(ops.sources, ["briefing", "perception"], "still records both sources");
  });

  it("a risk seen ONLY by perception/forecast (no measured confidence) is honestly 'unknown', not invented", () => {
    const perception = perceive({ now: NOW_ISO, freshness: fresh([dom("fitness", "unavailable")]) });
    const r = synthesizeFleet({ perception });
    const fitness = r.topRisks.find((x) => x.subject === "fitness")!;
    assert.ok(fitness, "the perception-only risk is surfaced");
    assert.equal(fitness.confidence, "unknown", "no measured band ⇒ honest 'unknown', never a fabricated confidence");
    assert.deepEqual(fitness.sources, ["perception"]);
  });

  it("a 'live' perception/forecast corroboration cannot UPGRADE a medium briefing item", () => {
    const briefing = assembleBriefing({
      signals: [fleetSignal("ops", "ops", { verdict: "urgent", confidence: "medium", freshness: "live" })],
      now: NOW,
    });
    const perception = perceive({ now: NOW_ISO, freshness: fresh([dom("ops", "stale")]) });
    const r = synthesizeFleet({ briefing, perception });
    const ops = r.topRisks.find((x) => x.subject === "ops")!;
    assert.equal(ops.confidence, "medium", "a non-confidence source carries no band — cannot upgrade");
  });
});

// ─── HONEST COVERAGE — an absent source is named, not silently dropped ────────────

describe("fleet-synthesis — honest coverage", () => {
  it("an absent forecast is named as reduced coverage; others still synthesized", () => {
    const briefing = assembleBriefing({
      signals: [fleetSignal("ops", "ops", { verdict: "urgent", confidence: "high", freshness: "live" })],
      now: NOW,
    });
    const perception = perceive({ now: NOW_ISO, freshness: fresh([dom("ops", "stale")]) });

    const r = synthesizeFleet({ briefing, perception }); // no forecast
    assert.deepEqual(r.coverage.sources, ["briefing", "perception"]);
    assert.deepEqual(r.coverage.absentSources, ["forecast"], "the absent source is named honestly");
    assert.ok(r.topRisks.length > 0, "the available sources are still synthesized");
    assert.match(r.note, /forecast/, "the note surfaces the reduced coverage");
  });

  it("carries perception + forecast blind spots up into coverage, deduped and sorted", () => {
    const perception = perceive({ now: NOW_ISO, freshness: fresh([dom("fitness", "unavailable")]) }); // fitness blind
    const fc = forecast({ now: NOW_ISO, perception }); // carries 'fitness' forward
    const r = synthesizeFleet({ perception, forecast: fc });
    assert.ok(r.coverage.blindSpots.includes("fitness"), "blind spots are surfaced, not hidden");
    // sorted + deduped
    assert.deepEqual(r.coverage.blindSpots, [...r.coverage.blindSpots].sort());
    assert.equal(new Set(r.coverage.blindSpots).size, r.coverage.blindSpots.length, "deduped");
  });
});

// ─── EMPTY — honest empty rollup naming what it couldn't see ──────────────────────

describe("fleet-synthesis — empty", () => {
  it("nothing in ⇒ an honest empty rollup naming all three absent sources, no fabrication", () => {
    const r = synthesizeFleet({});
    assert.deepEqual(r.topRisks, [], "no risks fabricated from nothing");
    assert.equal(r.confidence, "unknown", "an empty rollup has unknown confidence");
    assert.deepEqual(r.coverage.sources, []);
    assert.deepEqual(r.coverage.absentSources, ["briefing", "perception", "forecast"]);
    assert.match(r.note, /nothing to synthesize/i, "the note names the gap honestly");
  });

  it("present sources but zero risks ⇒ honest 'no risks' note, not silence", () => {
    // A clean briefing (green verdict) + clean perception (nothing flagged) → risks may exist at
    // severity 0; an empty perception with no freshness flags nothing.
    const r = synthesizeFleet({ perception: perceive({ now: NOW_ISO, freshness: fresh([]) }) });
    assert.ok(r.coverage.sources.includes("perception"));
    assert.match(r.note, /coverage|risk|blind/i, "names coverage state honestly");
  });
});

// ─── DETERMINISM ──────────────────────────────────────────────────────────────────

describe("fleet-synthesis — determinism", () => {
  it("same input twice ⇒ deep-equal rollup (stable ranking)", () => {
    const build = () => {
      const briefing = assembleBriefing({
        signals: [
          fleetSignal("ops", "ops", { verdict: "urgent", confidence: "high", freshness: "live" }),
          fleetSignal("fitness", "fitness", { verdict: "amber", confidence: "medium", freshness: "fresh" }),
        ],
        now: NOW,
      });
      const perception = perceive({ now: NOW_ISO, freshness: fresh([dom("ops", "stale"), dom("fitness", "unavailable")]) });
      const fc = forecast({ now: NOW_ISO, perception });
      return synthesizeFleet({ briefing, perception, forecast: fc });
    };
    assert.deepEqual(build(), build());
  });

  it("ranking is stable: higher severity first regardless of input shape", () => {
    const briefing = assembleBriefing({
      signals: [
        fleetSignal("fitness", "fitness", { verdict: "green", confidence: "high", freshness: "live" }), // sev 0
        fleetSignal("ops", "ops", { verdict: "urgent", confidence: "high", freshness: "live" }), // sev 3
      ],
      now: NOW,
    });
    const r = synthesizeFleet({ briefing });
    assert.equal(r.topRisks[0]!.subject, "ops", "urgent (sev 3) ranks above green (sev 0)");
    assert.ok(r.topRisks.findIndex((x) => x.subject === "fitness") > 0);
  });
});
