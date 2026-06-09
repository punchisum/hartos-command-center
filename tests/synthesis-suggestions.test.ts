/**
 * tests/synthesis-suggestions.test.ts — TRACK B: the cross-agent action surface.
 *
 * `suggestionsFromSynthesis` turns the CORRELATED (multi-source) risks from `synthesizeFleet`
 * into `SuggestedAction`s — the cross-agent insights the single-source `suggestActions` pass
 * cannot produce. These tests pin the contract:
 *   • CORRELATED (2+ source) risk ⇒ a SuggestedAction with honest priority (from severity, never
 *     inflated by confidence), a rationale naming the contributing sources + the §19-clamped band,
 *     and a STABLE deterministic id keyed on the subject token.
 *   • SINGLE-SOURCE risk ⇒ OMITTED (documented: already covered by perception/forecast suggestions).
 *   • EMPTY / unavailable synthesis ⇒ [] (no fabrication).
 *   • DETERMINISM: same input twice ⇒ deep-equal.
 *   • IDs use a DISTINCT prefix (`sx-syn-`) so they never collide with the suggest-actions scheme
 *     (`sg-`), and they map through suggestionToProposal into a NON-EXECUTABLE draft (the floor).
 *
 * Fixtures use the REAL upstream synthesizers (assembleBriefing / perceive / forecast / the
 * synthesizeFleet rollup) so the suggestions sit on true shapes, not hand-built mocks.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  suggestionsFromSynthesis,
  SYNTHESIS_ID_PREFIX,
} from "../src/cockpit/suggestions/synthesis-suggestions.js";
import { suggestionToProposal } from "../src/cockpit/suggestions/suggest-actions.js";
import { synthesizeFleet } from "../src/fleet/fleet-synthesis.js";
import { assembleBriefing } from "../src/fleet/fleet-brain.js";
import { perceive } from "../src/rinnegan/perception.js";
import { forecast } from "../src/prophet/forecast.js";
import type { FleetSignal, AgentSignal } from "../src/read-models/agent-signal.js";
import type { FleetSynthesis } from "../src/fleet/fleet-synthesis.js";
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
function dom(domain: string, state: string) {
  return { domain, state, lastUpdated: "2026-06-05", reason: "r" };
}
function fresh(domains: ReturnType<typeof dom>[], clickupStale = false): FreshnessReport {
  return {
    verdict: "amber", verdictReason: "x", domains,
    clickup: { stale: clickupStale, lastImportAt: null }, staleReason: "", safeNextStep: "x",
  } as unknown as FreshnessReport;
}

/** A rollup where "ops" is correlated across briefing + perception + forecast (multi-source). */
function correlatedRollup(): FleetSynthesis {
  const briefing = assembleBriefing({
    signals: [fleetSignal("ops", "ops", { verdict: "urgent", confidence: "high", freshness: "live" })],
    now: NOW,
  });
  const perception = perceive({ now: NOW_ISO, freshness: fresh([dom("ops", "stale")]) }); // ops critical
  const fc = forecast({ now: NOW_ISO, perception }); // carries the ops subject forward
  return synthesizeFleet({ briefing, perception, forecast: fc });
}

// ─── CORRELATED (multi-source) risk → a SuggestedAction ───────────────────────────

describe("synthesis-suggestions — correlated risk → SuggestedAction", () => {
  it("emits a suggestion for a multi-source (2+ source) risk with honest priority + sourced rationale", () => {
    const synth = correlatedRollup();
    const opsRisk = synth.topRisks.find((r) => r.subject === "ops")!;
    assert.ok(opsRisk, "precondition: ops is in the rollup");
    assert.ok(opsRisk.sources.length > 1, "precondition: ops is cross-agent correlated");

    const actions = suggestionsFromSynthesis(synth);
    const ops = actions.find((a) => a.id === `${SYNTHESIS_ID_PREFIX}-ops`)!;
    assert.ok(ops, "the correlated ops risk produced a suggestion");

    // Honest priority straight from severity (sev 3 ⇒ high), never inflated by confidence.
    assert.equal(opsRisk.severity, 3);
    assert.equal(ops.priority, "high");
    assert.equal(ops.domain, "ops");
    assert.equal(ops.actionType, "ops_followup_plan");

    // Rationale names the contributing sources + the §19-clamped band — never fabricated.
    for (const src of opsRisk.sources) assert.match(ops.rationale, new RegExp(src));
    assert.match(ops.rationale, new RegExp(`confidence: ${opsRisk.confidence}`));
  });

  it("derives a LOWER priority for a lower-severity correlated risk (no inflation)", () => {
    // fitness 'unavailable' → perception warn/critical; correlate with a briefing 'stale' (sev 2)
    // fitness item so it is multi-source but not the maximal severity, and confirm priority tracks
    // the severity downward rather than being floated up.
    const briefing = assembleBriefing({
      signals: [fleetSignal("fitness", "fitness", { verdict: "stale", confidence: "medium", freshness: "stale" })],
      now: NOW,
    });
    const perception = perceive({ now: NOW_ISO, freshness: fresh([dom("fitness", "unavailable")]) });
    const fc = forecast({ now: NOW_ISO, perception });
    const synth = synthesizeFleet({ briefing, perception, forecast: fc });
    const fitnessRisk = synth.topRisks.find((r) => r.subject === "fitness")!;
    assert.ok(fitnessRisk.sources.length > 1, "precondition: fitness is correlated");

    const actions = suggestionsFromSynthesis(synth);
    const fitness = actions.find((a) => a.id === `${SYNTHESIS_ID_PREFIX}-fitness`)!;
    assert.ok(fitness, "the correlated fitness risk produced a suggestion");
    assert.equal(fitness.domain, "fitness");
    // Priority is exactly the severity-derived band — never above it.
    const expected = fitnessRisk.severity >= 3 ? "high" : fitnessRisk.severity === 2 ? "medium" : "low";
    assert.equal(fitness.priority, expected, "priority tracks severity, no inflation");
  });
});

// ─── SINGLE-SOURCE risk → OMITTED (documented) ────────────────────────────────────

describe("synthesis-suggestions — single-source risks are omitted", () => {
  it("does NOT emit a suggestion for a single-source risk (already covered by suggest-actions)", () => {
    // A briefing-ONLY ops item: synthesizeFleet records it as a single-source risk.
    const briefing = assembleBriefing({
      signals: [fleetSignal("ops", "ops", { verdict: "urgent", confidence: "high", freshness: "live" })],
      now: NOW,
    });
    const synth = synthesizeFleet({ briefing }); // no perception, no forecast
    const opsRisk = synth.topRisks.find((r) => r.subject === "ops")!;
    assert.deepEqual(opsRisk.sources, ["briefing"], "precondition: ops is single-source");

    const actions = suggestionsFromSynthesis(synth);
    assert.equal(actions.length, 0, "single-source risks are dropped — they are covered elsewhere");
  });

  it("emits ONLY the correlated subset when a rollup mixes single- and multi-source risks", () => {
    // A rollup that genuinely mixes both: a briefing-only ops signal (single-source) plus a
    // ClickUp staleness that perception flags AND forecast carries forward (multi-source). We
    // assert on the ACTUAL source counts (robust to which subject lands where) rather than a
    // hard-coded assumption: exactly the multi-source risks are emitted; every single-source one
    // is dropped.
    const briefing = assembleBriefing({
      signals: [
        // ops is also flagged by perception+forecast below ⇒ multi-source (correlated).
        fleetSignal("ops", "ops", { verdict: "urgent", confidence: "high", freshness: "live" }),
        // fitness is in the briefing ONLY — perception (driven by ops freshness) never touches it ⇒ single-source.
        fleetSignal("fitness", "fitness", { verdict: "urgent", confidence: "high", freshness: "live" }),
      ],
      now: NOW,
    });
    const perception = perceive({ now: NOW_ISO, freshness: fresh([dom("ops", "stale")], true) });
    const fc = forecast({ now: NOW_ISO, perception });
    const synth = synthesizeFleet({ briefing, perception, forecast: fc });

    const multi = synth.topRisks.filter((r) => r.sources.length > 1);
    const single = synth.topRisks.filter((r) => r.sources.length <= 1);
    assert.ok(multi.length > 0, "precondition: the rollup has at least one correlated (multi-source) risk");
    assert.ok(single.length > 0, "precondition: the rollup has at least one single-source risk (fitness, briefing-only)");

    const actions = suggestionsFromSynthesis(synth);
    assert.equal(actions.length, multi.length, "exactly the correlated risks are emitted; single-source dropped");
    assert.ok(actions.every((a) => a.id.startsWith(`${SYNTHESIS_ID_PREFIX}-`)), "all emitted ids are synthesis ids");
  });
});

// ─── EMPTY / unavailable synthesis → [] (no fabrication) ──────────────────────────

describe("synthesis-suggestions — empty / unavailable", () => {
  it("empty rollup ⇒ [] (no fabrication)", () => {
    const empty = synthesizeFleet({});
    assert.deepEqual(empty.topRisks, [], "precondition: nothing synthesized");
    assert.deepEqual(suggestionsFromSynthesis(empty), []);
  });

  it("null / undefined synthesis ⇒ []", () => {
    assert.deepEqual(suggestionsFromSynthesis(null), []);
    assert.deepEqual(suggestionsFromSynthesis(undefined), []);
  });

  it("a rollup with only single-source risks ⇒ [] (none correlated)", () => {
    const perception = perceive({ now: NOW_ISO, freshness: fresh([dom("ops", "stale")]) });
    const synth = synthesizeFleet({ perception }); // perception-only ⇒ every risk is single-source
    assert.ok(synth.topRisks.every((r) => r.sources.length === 1), "precondition: all single-source");
    assert.deepEqual(suggestionsFromSynthesis(synth), []);
  });
});

// ─── DETERMINISM + STABLE IDS ─────────────────────────────────────────────────────

describe("synthesis-suggestions — determinism + ids", () => {
  it("same input twice ⇒ deep-equal SuggestedAction[]", () => {
    const synth = correlatedRollup();
    assert.deepEqual(suggestionsFromSynthesis(synth), suggestionsFromSynthesis(synth));
  });

  it("ids are stable across bakes and keyed on the subject token", () => {
    const a = suggestionsFromSynthesis(correlatedRollup());
    const b = suggestionsFromSynthesis(correlatedRollup());
    assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id), "ids are stable, content-free of free text");
    assert.ok(a.every((x) => x.id === `${SYNTHESIS_ID_PREFIX}-${x.id.slice(SYNTHESIS_ID_PREFIX.length + 1)}`));
  });

  it("ids use a DISTINCT prefix and never collide with the suggest-actions scheme", () => {
    const actions = suggestionsFromSynthesis(correlatedRollup());
    assert.ok(actions.length > 0, "have at least one synthesis suggestion to check");
    for (const a of actions) {
      assert.ok(a.id.startsWith(`${SYNTHESIS_ID_PREFIX}-`), "synthesis prefix");
      assert.ok(!a.id.startsWith("sg-"), "never the suggest-actions prefix");
    }
  });

  it("respects the limit", () => {
    const synth = correlatedRollup();
    const capped = suggestionsFromSynthesis(synth, { limit: 0 });
    assert.deepEqual(capped, [], "limit 0 ⇒ nothing");
    const one = suggestionsFromSynthesis(synth, { limit: 1 });
    assert.ok(one.length <= 1, "respects a small cap");
  });
});

// ─── THE FLOOR — a synthesis suggestion maps to a NON-EXECUTABLE proposal ─────────

describe("synthesis-suggestions — propose-only floor", () => {
  it("maps through suggestionToProposal into a non-executable draft (nothing executes)", () => {
    const action = suggestionsFromSynthesis(correlatedRollup())[0]!;
    const draft = suggestionToProposal(action, NOW_ISO);
    assert.equal(draft.status, "draft");
    assert.equal(draft.executable, false, "non-executable — the human-approval floor never moves");
    assert.equal(draft.requiredApproval, "Hart");
    assert.equal(draft.id, action.id, "the synthesis id rides through unchanged");
    assert.equal(draft.domain, action.domain);
    assert.equal(draft.actionType, action.actionType);
    assert.match(draft.sourceIntent, /^suggested:/);
  });
});
