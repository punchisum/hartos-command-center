/**
 * tests/fleet-brain-view.test.ts
 *
 * `fleetBriefingView` is the read-only cockpit seam that turns a CockpitState snapshot into the
 * prioritized Fleet Brain briefing (master plan Level 3). These tests pin: a snapshot WITH live
 * read-model summaries → `available: true` + ranked briefing items whose `generatedAt` echoes the
 * INJECTED `now`; an undefined/empty snapshot → an honest `available: false` note (never a
 * fabricated briefing); and determinism (same state + same `now` → deep-equal).
 *
 * Hermetic: hand-built CockpitState fixtures, an injected `now` string — no env / network / fs /
 * Supabase / ambient clock. It REUSES the canon (`fleetView` + `assembleBriefing`) via the
 * view-builder; it does not re-derive signals or re-rank.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fleetBriefingView } from "../src/runtime/views/fleet-brain-view.js";
import type { CockpitState } from "../src/cockpit/cockpit-types.js";
import type { ReadModelSummary } from "../src/read-models/read-model-types.js";

const NOW = "2026-06-09T12:00:00.000Z";
const NOW_ISO = new Date(NOW).toISOString();

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

/** A CockpitState carrying the given read-model summaries (the only field the view reads from). */
function stateWith(summaries: ReadModelSummary[]): CockpitState {
  return { generatedAt: NOW, readModels: { summaries }, proposalQueue: [] } as unknown as CockpitState;
}

// An ops summary with urgent cards → verdict "urgent" (high severity); a fitness summary with a
// high recovery score → verdict "green" (calm). The briefing must rank "urgent" above "green".
const OPS_URGENT = summary({ id: "ops", type: "ops", metrics: { urgentCards: 2 } });
const FITNESS_CALM = summary({ id: "fitness", type: "fitness", metrics: { recovery: 80 } });

// ─── available: true + ranked items + generatedAt echoes the injected now ────────

describe("fleetBriefingView — available with resolved summaries", () => {
  it("resolves a briefing whose generatedAt echoes the injected now", () => {
    const view = fleetBriefingView(stateWith([OPS_URGENT, FITNESS_CALM]), NOW);
    assert.equal(view.available, true);
    assert.equal(view.available && view.generatedAt, NOW_ISO);
  });

  it("ranks the urgent ops signal above the calm fitness signal (reuses the brain's ranking)", () => {
    const view = fleetBriefingView(stateWith([FITNESS_CALM, OPS_URGENT]), NOW);
    assert.equal(view.available, true);
    if (!view.available) return;
    assert.equal(view.items.length, 2);
    // "urgent" (severity 3) outranks "green" (severity 0) regardless of input order.
    assert.equal(view.items[0]!.domain, "ops");
    assert.equal(view.items[1]!.domain, "fitness");
    // Owner resolution is honest — surfaced from the registry, not fabricated.
    assert.equal(view.items[0]!.ownerAgent, "Ops");
  });

  it("an unparseable now falls back to the deterministic epoch, never the ambient clock", () => {
    const view = fleetBriefingView(stateWith([OPS_URGENT]), "not-a-timestamp");
    assert.equal(view.available, true);
    assert.equal(view.available && view.generatedAt, new Date(0).toISOString());
  });
});

// ─── undefined / empty → honest available: false (never a fabricated briefing) ───

describe("fleetBriefingView — honest unavailable", () => {
  it("an undefined snapshot → available: false with a note (no fabricated briefing)", () => {
    const view = fleetBriefingView(undefined, NOW);
    assert.equal(view.available, false);
    if (view.available) return;
    assert.match(view.note, /unavailable/i);
    // No briefing fields leak onto an unavailable view.
    assert.equal("items" in view, false);
    assert.equal("generatedAt" in view, false);
  });

  it("a snapshot with no read-model summaries → available: false (honest, not empty-but-true)", () => {
    const view = fleetBriefingView(stateWith([]), NOW);
    assert.equal(view.available, false);
    if (view.available) return;
    assert.match(view.note, /no live read-model summaries/i);
  });
});

// ─── determinism ─────────────────────────────────────────────────────────────────

describe("fleetBriefingView — determinism", () => {
  it("same state + same now → deep-equal view", () => {
    const state = stateWith([OPS_URGENT, FITNESS_CALM]);
    assert.deepEqual(fleetBriefingView(state, NOW), fleetBriefingView(state, NOW));
  });

  it("the unavailable view is deterministic too", () => {
    assert.deepEqual(fleetBriefingView(undefined, NOW), fleetBriefingView(undefined, NOW));
  });
});
