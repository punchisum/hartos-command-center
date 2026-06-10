/**
 * tests/ask-forecast-grounding.test.ts
 *
 * `augmentGroundingWithForecast` enriches the Ask `AskGrounding` with PROPHET's
 * consequence-of-inaction forecast (the forward-tense layer), so "what's going to
 * bite me?" is grounded in what known issues BECOME, not just the present.
 *
 * Doctrine pinned:
 *   - a forward-looking intent + a real forecastable signal (an aging pending
 *     proposal) → `highlights` gains a "Forecast: …" verdict + "Consequence of
 *     inaction — …" projections; `gaps` gains Prophet's honest blind spots;
 *   - a NON-forecast intent → grounding returned BYTE-IDENTICAL;
 *   - no forecastable signal (empty state) → UNCHANGED (never fabricates);
 *   - summary/title untouched; input not mutated; deterministic.
 *
 * Hermetic: hand-built CockpitState + injected `now` — no env/network/fs/clock.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { augmentGroundingWithForecast } from "../src/llm/ask-forecast-grounding.js";
import type { AskGrounding } from "../src/llm/ask-llm.js";
import type { CockpitState } from "../src/cockpit/cockpit-types.js";
import type { ProposalQueueItem } from "../src/cockpit/proposals/proposal-types.js";

const NOW = "2026-06-09T12:00:00.000Z";
const NOW_MS = new Date(NOW).getTime();
// 5 days before NOW → older than the 72h aging threshold → a stalled-decision consequence.
const AGING = new Date(NOW_MS - 5 * 24 * 3_600_000).toISOString();

function agingProposal(): ProposalQueueItem {
  return { id: "p1", status: "pending_approval", createdAt: AGING } as unknown as ProposalQueueItem;
}

function stateWith(proposals: ProposalQueueItem[]): CockpitState {
  return { generatedAt: NOW, proposalQueue: proposals, memorySnapshots: [] } as unknown as CockpitState;
}

function baseGrounding(over: Partial<AskGrounding> = {}): AskGrounding {
  return {
    summary: "All agents nominal at the time of the snapshot.",
    title: "Ask HartOS",
    highlights: ["Fitness: recovery 80"],
    gaps: ["No live ClickUp read-model configured"],
    ...over,
  };
}

describe("augmentGroundingWithForecast — forward-looking intent + real signal", () => {
  it("appends the forecast verdict + consequence projections as highlights", () => {
    const before = baseGrounding();
    const after = augmentGroundingWithForecast(before, stateWith([agingProposal()]), NOW, { intent: "system_status" });

    assert.ok(after.highlights!.includes("Fitness: recovery 80"), "base highlight preserved");
    assert.ok(after.highlights!.some((h) => h.startsWith("Forecast:")), "forecast verdict surfaced");
    const consequence = after.highlights!.find((h) => h.startsWith("Consequence of inaction —"));
    assert.ok(consequence, "a consequence-of-inaction projection is surfaced");
    assert.match(consequence!, /proposals/, "the aging-proposal consequence names its subject");
    assert.ok(after.highlights!.length > before.highlights!.length, "added, never removed");
  });

  it("appends Prophet's blind spots as honest gaps", () => {
    const before = baseGrounding();
    const after = augmentGroundingWithForecast(before, stateWith([agingProposal()]), NOW, { intent: "daily_brief" });
    assert.ok(after.gaps!.includes("No live ClickUp read-model configured"), "base gap preserved");
    assert.ok(after.gaps!.some((g) => g.startsWith("Prophet cannot foresee:")), "blind spots surfaced as gaps");
  });

  it("does NOT modify summary or title", () => {
    const before = baseGrounding({ summary: "leave me alone", title: "Custom" });
    const after = augmentGroundingWithForecast(before, stateWith([agingProposal()]), NOW, { intent: "ops_status" });
    assert.equal(after.summary, "leave me alone");
    assert.equal(after.title, "Custom");
  });
});

describe("augmentGroundingWithForecast — behaviour-preserving", () => {
  it("a non-forecast intent returns the grounding deep-equal", () => {
    const before = baseGrounding();
    const after = augmentGroundingWithForecast(before, stateWith([agingProposal()]), NOW, { intent: "build_agent" });
    assert.deepEqual(after, before);
  });

  it("no intent → the exact grounding object is returned", () => {
    const before = baseGrounding();
    const same = augmentGroundingWithForecast(before, stateWith([agingProposal()]), NOW);
    assert.equal(same, before);
  });

  it("no forecastable signal (empty state) → unchanged, never fabricates", () => {
    const before = baseGrounding();
    const after = augmentGroundingWithForecast(before, stateWith([]), NOW, { intent: "system_status" });
    assert.deepEqual(after, before);
    assert.deepEqual(augmentGroundingWithForecast(before, undefined, NOW, { intent: "system_status" }), before);
  });
});

describe("augmentGroundingWithForecast — determinism + purity", () => {
  it("same inputs → deep-equal", () => {
    const state = stateWith([agingProposal()]);
    const a = augmentGroundingWithForecast(baseGrounding(), state, NOW, { intent: "system_status" });
    const b = augmentGroundingWithForecast(baseGrounding(), state, NOW, { intent: "system_status" });
    assert.deepEqual(a, b);
  });

  it("does not mutate the input grounding", () => {
    const before = baseGrounding();
    const hl = [...before.highlights!];
    const gp = [...before.gaps!];
    augmentGroundingWithForecast(before, stateWith([agingProposal()]), NOW, { intent: "system_status" });
    assert.deepEqual(before.highlights, hl);
    assert.deepEqual(before.gaps, gp);
  });
});
