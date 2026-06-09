/**
 * tests/fleet-synthesis-view.test.ts
 *
 * `fleetSynthesisView` is the read-only cockpit seam that turns a CockpitState snapshot into the
 * ONE cross-agent SYNTHESIS rollup (3-levels-up master plan Level 3 — fleet intelligence). It
 * composes the same pure brains the cockpit already runs — `assembleBriefing` (the RAW briefing
 * the way `fleetBriefingView` builds it), `perceive` + `forecast` (the way the hosted page builds
 * them), and `synthesizeFleet` (verbatim) — into `{ topRisks, coverage, confidence }`.
 *
 * These tests pin: a snapshot WITH live read-model summaries → `available: true` + the rollup
 * (topRisks / coverage / confidence) marked non-executable; an undefined/empty snapshot → an
 * honest `available: false` note (never a fabricated rollup); §19 — a STALE contributing input
 * keeps the merged risk's confidence weak (asserted via real `synthesizeFleet` behavior, not a
 * re-implementation); `executable:"disabled"`; and determinism (same state + same `now` →
 * deep-equal).
 *
 * Hermetic: hand-built CockpitState fixtures, an injected `now` string — no env / network / fs /
 * Supabase / ambient clock. It REUSES the canon via the view-builder; it does not re-derive
 * signals, re-rank, or re-clamp confidence.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fleetSynthesisView } from "../src/runtime/views/fleet-synthesis-view.js";
import type { CockpitState } from "../src/cockpit/cockpit-types.js";
import type { ReadModelSummary } from "../src/read-models/read-model-types.js";

const NOW = "2026-06-09T12:00:00.000Z";
const NOW_MS = new Date(NOW).getTime();
// 48h before NOW → freshnessFromAge() returns "stale" (>24h, ≤72h), degrading confidence one band.
const STALE_48H = new Date(NOW_MS - 48 * 3_600_000).toISOString();

// ─── Fixtures (all explicit — no hidden defaults that read the clock) ────────────

/** A read-model summary fixture. `dataFreshness` defaults to `now` so freshness is "live". */
function summary(over: Partial<ReadModelSummary> = {}): ReadModelSummary {
  return {
    id: "ops",
    type: "ops",
    status: "ok",
    confidence: "high",
    lines: ["ops summary line"],
    metrics: {},
    recommendation: "review the queue",
    dataFreshness: NOW,
    degradedSources: [],
    ...over,
  };
}

/** A CockpitState carrying the given read-model summaries (the field the view reads from). */
function stateWith(summaries: ReadModelSummary[]): CockpitState {
  return { generatedAt: NOW, readModels: { summaries }, proposalQueue: [] } as unknown as CockpitState;
}

// An ops summary with urgent cards → verdict "urgent" (high severity). Two variants of the SAME
// subject ("ops"): one with LIVE freshness (confidence stays "high"), one with STALE freshness
// (confidence "high" is degraded one band by the briefing's §19 clamp before synthesis sees it).
const OPS_URGENT_LIVE = summary({ id: "ops", type: "ops", confidence: "high", metrics: { urgentCards: 2 }, dataFreshness: NOW });
const OPS_URGENT_STALE = summary({ id: "ops", type: "ops", confidence: "high", metrics: { urgentCards: 2 }, dataFreshness: STALE_48H });
const FITNESS_CALM = summary({ id: "fitness", type: "fitness", metrics: { recovery: 80 }, dataFreshness: NOW });

const CONFIDENCE_RANK: Record<string, number> = { unknown: 0, low: 1, medium: 2, high: 3 };

// ─── available: true + rollup present + non-executable ───────────────────────────

describe("fleetSynthesisView — available with resolved summaries", () => {
  it("resolves a non-executable read-only rollup carrying topRisks / coverage / confidence", () => {
    const view = fleetSynthesisView(stateWith([OPS_URGENT_LIVE, FITNESS_CALM]), NOW);
    assert.equal(view.available, true);
    if (!view.available) return;
    assert.equal(view.mode, "read_only_snapshot");
    assert.equal(view.executable, "disabled");
    // The rollup is present and honest about what it saw.
    assert.ok(Array.isArray(view.topRisks));
    assert.ok(view.topRisks.length >= 1, "the urgent ops signal should surface as a risk");
    assert.ok(view.coverage.sources.includes("briefing"), "the briefing source fed the rollup");
    assert.ok(typeof view.note === "string" && view.note.length > 0);
    // The top risk names its subject + contributing sources (cross-agent provenance), never fabricated.
    const ops = view.topRisks.find((r) => r.subject === "ops");
    assert.ok(ops, "the ops risk is present");
    assert.ok(ops!.sources.includes("briefing"));
  });

  it("the rollup confidence is a real band drawn from the synthesized risks (not invented)", () => {
    const view = fleetSynthesisView(stateWith([OPS_URGENT_LIVE]), NOW);
    assert.equal(view.available, true);
    if (!view.available) return;
    assert.ok(["unknown", "low", "medium", "high"].includes(view.confidence));
  });
});

// ─── undefined / empty → honest available: false (never a fabricated rollup) ─────

describe("fleetSynthesisView — honest unavailable", () => {
  it("an undefined snapshot → available: false with a note (no fabricated rollup)", () => {
    const view = fleetSynthesisView(undefined, NOW);
    assert.equal(view.available, false);
    if (view.available) return;
    assert.match(view.note, /unavailable/i);
    assert.equal(view.executable, "disabled");
    // No rollup fields leak onto an unavailable view.
    assert.equal("topRisks" in view, false);
    assert.equal("coverage" in view, false);
  });

  it("a snapshot with no read-model summaries → available: false (honest, not empty-but-true)", () => {
    const view = fleetSynthesisView(stateWith([]), NOW);
    assert.equal(view.available, false);
    if (view.available) return;
    assert.match(view.note, /no live read-model summaries/i);
  });
});

// ─── §19 — a stale contributing input keeps the merged risk confidence weak ──────

describe("fleetSynthesisView — §19 no-laundering (stale input keeps confidence weak)", () => {
  it("a stale ops signal yields a WEAKER merged confidence than the same signal fresh", () => {
    const liveView = fleetSynthesisView(stateWith([OPS_URGENT_LIVE]), NOW);
    const staleView = fleetSynthesisView(stateWith([OPS_URGENT_STALE]), NOW);
    assert.equal(liveView.available, true);
    assert.equal(staleView.available, true);
    if (!liveView.available || !staleView.available) return;

    const liveOps = liveView.topRisks.find((r) => r.subject === "ops");
    const staleOps = staleView.topRisks.find((r) => r.subject === "ops");
    assert.ok(liveOps && staleOps, "both rollups surface the ops risk");

    // The ONLY difference between the two fixtures is freshness. The §19 clamp (folded by
    // assembleBriefing, preserved verbatim by synthesizeFleet) must degrade the stale variant's
    // confidence below the live one's — combining sources never launders it back up.
    assert.ok(
      CONFIDENCE_RANK[staleOps!.confidence]! < CONFIDENCE_RANK[liveOps!.confidence]!,
      `stale confidence (${staleOps!.confidence}) must be weaker than live (${liveOps!.confidence})`,
    );
    // And the rollup confidence (weakest band across top risks) cannot exceed the stale risk's.
    assert.ok(CONFIDENCE_RANK[staleView.confidence]! <= CONFIDENCE_RANK[staleOps!.confidence]!);
  });
});

// ─── executable: disabled (doctrine — read-only views never execute) ─────────────

describe("fleetSynthesisView — read-only doctrine", () => {
  it("is executable:\"disabled\" whether available or not", () => {
    const ok = fleetSynthesisView(stateWith([OPS_URGENT_LIVE]), NOW);
    const empty = fleetSynthesisView(stateWith([]), NOW);
    assert.equal(ok.executable, "disabled");
    assert.equal(empty.executable, "disabled");
  });
});

// ─── determinism ─────────────────────────────────────────────────────────────────

describe("fleetSynthesisView — determinism", () => {
  it("same state + same now → deep-equal view", () => {
    const state = stateWith([OPS_URGENT_LIVE, FITNESS_CALM]);
    assert.deepEqual(fleetSynthesisView(state, NOW), fleetSynthesisView(state, NOW));
  });

  it("the unavailable view is deterministic too", () => {
    assert.deepEqual(fleetSynthesisView(undefined, NOW), fleetSynthesisView(undefined, NOW));
  });
});
