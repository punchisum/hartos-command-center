/**
 * tests/research-synthesis.test.ts — the Research Agent's synthesis core.
 *
 * Proves the honesty floor (no fabrication; unanswered → unknown), source-cited findings,
 * corroboration-driven confidence, reusable knowledge items, and determinism.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { synthesizeResearch, summarizeDossier, type GatheredSource } from "../src/research/research-synthesis.js";
import { planResearch } from "../src/research/research-planner.js";

const NOW = "2026-06-10T12:00:00Z";
const PLAN = planResearch("compare Postgres and SQLite for an edge app");

function src(over: Partial<GatheredSource>): GatheredSource {
  return { ref: "s1", title: "Source 1", content: "Postgres is a server database. It scales well.", answers: [0], asOf: NOW, ...over };
}

describe("synthesizeResearch", () => {
  it("synthesizes a source-cited finding and earns HIGH confidence on corroboration", () => {
    const gathered: GatheredSource[] = [
      src({ ref: "pg-docs", content: "Postgres is a client-server RDBMS suited to concurrent writes.", answers: [0] }),
      src({ ref: "edge-guide", content: "SQLite is an embedded database ideal for edge/local reads.", answers: [0] }),
    ];
    const d = synthesizeResearch(PLAN, gathered, { now: NOW });
    const f = d.keyFindings.find((x) => x.question === PLAN.subQuestions[0])!;
    assert.ok(f, "produced a finding for sub-question 0");
    assert.equal(f.confidence, "high"); // 2 distinct sources ≥ corroboration floor
    assert.deepEqual(f.sources.sort(), ["edge-guide", "pg-docs"]);
    assert.ok(f.finding.length > 0);
  });

  it("is MEDIUM on a single source, and lists the rest as honest unknowns", () => {
    const d = synthesizeResearch(PLAN, [src({ ref: "only", answers: [1] })], { now: NOW });
    const f = d.keyFindings.find((x) => x.question === PLAN.subQuestions[1])!;
    assert.equal(f.confidence, "medium");
    // Every other sub-question has no bearing source → unknown, never fabricated.
    assert.equal(d.unknowns.length, PLAN.subQuestions.length - 1);
    assert.ok(d.unknowns.every((u) => /Unanswered until sources are gathered/.test(u)));
  });

  it("honesty floor: nothing gathered ⇒ all-unknowns at 'unknown' confidence, no fabrication", () => {
    const d = synthesizeResearch(PLAN, [], { now: NOW });
    assert.equal(d.keyFindings.length, 0);
    assert.equal(d.knowledgeItems.length, 0);
    assert.equal(d.unknowns.length, PLAN.subQuestions.length);
    assert.equal(d.confidence, "unknown");
    assert.match(d.executiveSummary.join(" "), /never fabricated/i);
  });

  it("turns corroborated findings into reusable knowledge items applicable across HartOS", () => {
    const gathered: GatheredSource[] = [
      src({ ref: "a", content: "Edge apps favor low-latency local reads.", answers: [0] }),
      src({ ref: "b", content: "Edge apps favor low-latency local reads.", answers: [0] }),
    ];
    const d = synthesizeResearch(PLAN, gathered, { now: NOW });
    assert.ok(d.knowledgeItems.length >= 1);
    const k = d.knowledgeItems[0];
    assert.ok(k.appliesTo.some((a) => /HartOS Ask/.test(a)));
    assert.ok(k.sources.length >= 1);
  });

  it("multiple distinct cited sources → HIGH confidence, detail not duplicated", () => {
    const gathered: GatheredSource[] = [
      { ref: "https://a", title: "A", content: "Shared cited answer.", answers: [0], asOf: NOW },
      { ref: "https://b", title: "B", content: "Shared cited answer.", answers: [0], asOf: NOW },
      { ref: "https://c", title: "C", content: "Shared cited answer.", answers: [0], asOf: NOW },
    ];
    const d = synthesizeResearch(PLAN, gathered, { now: NOW });
    const f = d.keyFindings.find((x) => x.question === PLAN.subQuestions[0])!;
    assert.equal(f.confidence, "high"); // 3 distinct URL refs ≥ corroboration floor
    assert.equal(f.sources.length, 3);
    assert.equal(f.detail, "Shared cited answer."); // deduped, not repeated 3×
  });

  it("a finding never has zero sources (zero-source items are unknowns, not findings)", () => {
    const d = synthesizeResearch(PLAN, [src({ answers: [2] })], { now: NOW });
    assert.ok(d.keyFindings.every((f) => f.sources.length >= 1));
  });

  it("is deterministic and summarizes honestly", () => {
    const g = [src({ ref: "x", answers: [0] }), src({ ref: "y", answers: [3] })];
    assert.deepEqual(synthesizeResearch(PLAN, g, { now: NOW }), synthesizeResearch(PLAN, g, { now: NOW }));
    assert.match(summarizeDossier(synthesizeResearch(PLAN, g, { now: NOW })), /Research ".*": \d+ finding/);
  });
});
