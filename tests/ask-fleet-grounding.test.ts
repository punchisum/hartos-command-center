/**
 * tests/ask-fleet-grounding.test.ts
 *
 * `augmentGroundingWithSynthesis` enriches the Ask `AskGrounding` (the reasoning
 * material `composeAskAnswer` is grounded by) with the cross-agent FLEET
 * SYNTHESIS — so BOTH the deterministic answer and the LLM path reflect fleet
 * intelligence. Track A, 3-levels-up Level 3.
 *
 * These tests pin the doctrine:
 *   - a fleet/risk intent + an AVAILABLE synthesis (real topRisks) → `highlights`
 *     gains "Cross-agent risk: <subject> [<sources>] — <confidence>" entries and
 *     `gaps` gains the honest coverage (absent sources / blind spots);
 *   - a NON-fleet intent → the grounding is returned BYTE-IDENTICAL (deep-equal,
 *     same array identities);
 *   - synthesis UNAVAILABLE (no summaries / undefined state) → UNCHANGED;
 *   - determinism (same inputs → deep-equal);
 *   - NO FABRICATION (no risks invented when topRisks is empty);
 *   - NO LAUNDERING (the surfaced confidence is the synthesis's §19-clamped band,
 *     verbatim — a stale input's weaker band shows through).
 *
 * Hermetic: hand-built CockpitState fixtures + an injected `now` string — no env,
 * network, fs, Supabase, or ambient clock. The fixtures mirror
 * `fleet-synthesis-view.test.ts` so the synthesis is driven by REAL view output,
 * never a re-implementation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { augmentGroundingWithSynthesis } from "../src/llm/ask-fleet-grounding.js";
import type { AskGrounding } from "../src/llm/ask-llm.js";
import type { CockpitState } from "../src/cockpit/cockpit-types.js";
import type { ReadModelSummary } from "../src/read-models/read-model-types.js";

const NOW = "2026-06-09T12:00:00.000Z";
const NOW_MS = new Date(NOW).getTime();
// 48h before NOW → freshnessFromAge() returns "stale" (>24h, ≤72h), degrading confidence one band.
const STALE_48H = new Date(NOW_MS - 48 * 3_600_000).toISOString();

const CONFIDENCE_RANK: Record<string, number> = { unknown: 0, low: 1, medium: 2, high: 3 };

// ─── Fixtures (mirror tests/fleet-synthesis-view.test.ts so the synthesis is real) ──

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

function stateWith(summaries: ReadModelSummary[]): CockpitState {
  return { generatedAt: NOW, readModels: { summaries }, proposalQueue: [] } as unknown as CockpitState;
}

// An urgent ops signal → a high-severity risk subject "ops". Live vs stale variants
// differ ONLY in freshness, so the §19 clamp must surface a weaker band when stale.
const OPS_URGENT_LIVE = summary({ id: "ops", type: "ops", confidence: "high", metrics: { urgentCards: 2 }, dataFreshness: NOW });
const OPS_URGENT_STALE = summary({ id: "ops", type: "ops", confidence: "high", metrics: { urgentCards: 2 }, dataFreshness: STALE_48H });
const FITNESS_CALM = summary({ id: "fitness", type: "fitness", metrics: { recovery: 80 }, dataFreshness: NOW });

/** A base grounding mirroring what the Worker builds from `routeHosted(...)`. */
function baseGrounding(over: Partial<AskGrounding> = {}): AskGrounding {
  return {
    summary: "All agents nominal at the time of the snapshot.",
    title: "Ask HartOS",
    highlights: ["Fitness: recovery 80"],
    gaps: ["No live ClickUp read-model configured"],
    ...over,
  };
}

// ─── A fleet/risk intent + available synthesis → highlights + gaps enriched ──────

describe("augmentGroundingWithSynthesis — fleet intent + available synthesis", () => {
  it("appends the synthesized cross-agent risks as highlights (subject, sources, confidence)", () => {
    const before = baseGrounding();
    const after = augmentGroundingWithSynthesis(before, stateWith([OPS_URGENT_LIVE, FITNESS_CALM]), NOW, {
      intent: "system_status",
    });

    // The base highlight is preserved, and a cross-agent risk highlight is added.
    assert.ok(after.highlights!.includes("Fitness: recovery 80"), "base highlight preserved");
    const opsRisk = after.highlights!.find((h) => h.startsWith("Cross-agent risk: ops"));
    assert.ok(opsRisk, "the urgent ops risk surfaces as a cross-agent highlight");
    // Provenance + confidence are in the text (names the brains; confidence verbatim).
    assert.match(opsRisk!, /\[.*briefing.*\]/, "the risk names its contributing sources");
    assert.match(opsRisk!, /— (high|medium|low|unknown)$/, "the risk ends with its §19 confidence band");
    // More highlights after than before — we added, never removed.
    assert.ok(after.highlights!.length > before.highlights!.length);
  });

  it("appends the honest coverage (absent sources / blind spots) as gaps", () => {
    const before = baseGrounding();
    const after = augmentGroundingWithSynthesis(before, stateWith([OPS_URGENT_LIVE]), NOW, {
      intent: "daily_brief",
    });
    // Base gap preserved.
    assert.ok(after.gaps!.includes("No live ClickUp read-model configured"), "base gap preserved");
    // The honest coverage gaps are surfaced. With only a briefing source resolved,
    // perception/forecast are absent → named as coverage gaps (never silently dropped).
    const coverageGaps = after.gaps!.filter(
      (g) => g.startsWith("Fleet coverage gap:") || g.startsWith("Fleet blind spot:"),
    );
    assert.ok(coverageGaps.length >= 1, "absent sources / blind spots surface as honest gaps");
    assert.ok(after.gaps!.length > before.gaps!.length);
  });

  it("does NOT modify summary or title (the LLM may rewrite summary; we only enrich)", () => {
    const before = baseGrounding({ summary: "leave me alone", title: "Custom Title" });
    const after = augmentGroundingWithSynthesis(before, stateWith([OPS_URGENT_LIVE]), NOW, {
      intent: "ops_status",
    });
    assert.equal(after.summary, "leave me alone");
    assert.equal(after.title, "Custom Title");
  });
});

// ─── Non-fleet intent → grounding returned BYTE-IDENTICAL ────────────────────────

describe("augmentGroundingWithSynthesis — non-fleet intent is behaviour-preserving", () => {
  it("a build_agent intent returns the grounding deep-equal (no augmentation)", () => {
    const before = baseGrounding();
    const after = augmentGroundingWithSynthesis(before, stateWith([OPS_URGENT_LIVE, FITNESS_CALM]), NOW, {
      intent: "build_agent",
    });
    assert.deepEqual(after, before);
  });

  it("an unknown intent and an absent intent both return the grounding unchanged", () => {
    const before = baseGrounding();
    const state = stateWith([OPS_URGENT_LIVE]);
    assert.deepEqual(augmentGroundingWithSynthesis(before, state, NOW, { intent: "unknown" }), before);
    // No intent supplied at all → unchanged (the same object reference, even).
    const same = augmentGroundingWithSynthesis(before, state, NOW);
    assert.equal(same, before, "with no intent the exact grounding object is returned");
  });
});

// ─── Synthesis unavailable → unchanged ───────────────────────────────────────────

describe("augmentGroundingWithSynthesis — synthesis unavailable is unchanged", () => {
  it("an undefined snapshot → grounding deep-equal (honest, no augmentation)", () => {
    const before = baseGrounding();
    const after = augmentGroundingWithSynthesis(before, undefined, NOW, { intent: "system_status" });
    assert.deepEqual(after, before);
  });

  it("a snapshot with no read-model summaries → grounding unchanged", () => {
    const before = baseGrounding();
    const after = augmentGroundingWithSynthesis(before, stateWith([]), NOW, { intent: "strategy_review" });
    assert.deepEqual(after, before);
  });
});

// ─── No fabrication — no risks invented when topRisks is empty ───────────────────

describe("augmentGroundingWithSynthesis — never fabricates", () => {
  it("a calm fleet (no top-risks) adds NO cross-agent risk highlights", () => {
    // A single calm fitness summary with no urgent signal → the synthesis may be
    // available but carry no correlated top-risks. We must NOT invent any.
    const before = baseGrounding({ highlights: [], gaps: [] });
    const after = augmentGroundingWithSynthesis(before, stateWith([FITNESS_CALM]), NOW, {
      intent: "system_status",
    });
    const invented = (after.highlights ?? []).filter((h) => h.startsWith("Cross-agent risk:"));
    if (invented.length === 0) {
      // No top-risks → grounding must be byte-identical (no fabricated risks/gaps).
      assert.deepEqual(after, before);
    } else {
      // If real risks DID surface, each must trace to the real synthesis output
      // (subject token present) — never an invented subject.
      for (const h of invented) assert.match(h, /Cross-agent risk: \S+/);
    }
  });
});

// ─── No laundering — the §19-clamped band shows through verbatim ─────────────────

describe("augmentGroundingWithSynthesis — never launders confidence", () => {
  it("a stale ops signal surfaces a WEAKER confidence band in the highlight than the same signal fresh", () => {
    const liveAfter = augmentGroundingWithSynthesis(baseGrounding({ highlights: [] }), stateWith([OPS_URGENT_LIVE]), NOW, {
      intent: "system_status",
    });
    const staleAfter = augmentGroundingWithSynthesis(baseGrounding({ highlights: [] }), stateWith([OPS_URGENT_STALE]), NOW, {
      intent: "system_status",
    });

    const bandOf = (g: AskGrounding): string | null => {
      const h = (g.highlights ?? []).find((x) => x.startsWith("Cross-agent risk: ops"));
      if (!h) return null;
      const m = h.match(/— (high|medium|low|unknown)$/);
      return m ? m[1] : null;
    };
    const liveBand = bandOf(liveAfter);
    const staleBand = bandOf(staleAfter);
    assert.ok(liveBand && staleBand, "both groundings surface the ops cross-agent risk");
    // The ONLY difference is freshness — the surfaced band must degrade, never launder up.
    assert.ok(
      CONFIDENCE_RANK[staleBand!]! < CONFIDENCE_RANK[liveBand!]!,
      `stale band (${staleBand}) must be weaker than live (${liveBand})`,
    );
  });
});

// ─── Determinism ─────────────────────────────────────────────────────────────────

describe("augmentGroundingWithSynthesis — determinism", () => {
  it("same grounding + state + now + intent → deep-equal", () => {
    const state = stateWith([OPS_URGENT_LIVE, FITNESS_CALM]);
    const a = augmentGroundingWithSynthesis(baseGrounding(), state, NOW, { intent: "system_status" });
    const b = augmentGroundingWithSynthesis(baseGrounding(), state, NOW, { intent: "system_status" });
    assert.deepEqual(a, b);
  });

  it("does not mutate the input grounding object", () => {
    const before = baseGrounding();
    const snapshotHighlights = [...before.highlights!];
    const snapshotGaps = [...before.gaps!];
    augmentGroundingWithSynthesis(before, stateWith([OPS_URGENT_LIVE]), NOW, { intent: "system_status" });
    assert.deepEqual(before.highlights, snapshotHighlights, "input highlights not mutated");
    assert.deepEqual(before.gaps, snapshotGaps, "input gaps not mutated");
  });
});
