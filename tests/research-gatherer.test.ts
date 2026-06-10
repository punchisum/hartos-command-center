/**
 * tests/research-gatherer.test.ts — the gated gathering edge (pure orchestration + honesty rule).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gatherSources, llmResultToSources, type SourceFetcher } from "../src/research/research-gatherer.js";
import { planResearch } from "../src/research/research-planner.js";
import { RESEARCH_AGENT_SPEC } from "../src/agents/research-agent-spec.js";
import type { BoundaryDefinition } from "../src/research/agent-job-types.js";
import type { LlmResult, LlmStructuredOutput } from "../src/llm/llm-types.js";

const NOW = "2026-06-10T12:00:00Z";
const PLAN = planResearch("compare Postgres and SQLite for an edge app");

function llmResult(over: Partial<LlmResult> = {}, summary = "Postgres is server-based; SQLite is embedded."): LlmResult {
  const output: LlmStructuredOutput = {
    intent: "i", domain: "research", confidence: "medium", neededContext: [], recommendedSpecialist: "",
    riskLevel: "low", nextAction: "", summary,
  };
  return { output, provider: "openai", model: "gpt-5.5", mode: "openai", validation: "valid", success: true, requestType: "summarize_data_snapshot", ...over };
}

describe("llmResultToSources — only a real model counts as a source", () => {
  it("accepts a real openai result as a cited source", () => {
    const s = llmResultToSources(llmResult(), "q", 0, NOW);
    assert.equal(s.length, 1);
    assert.equal(s[0].ref, "llm:gpt-5.5");
    assert.deepEqual(s[0].answers, [0]);
    assert.ok(s[0].content.length > 0);
  });

  it("REFUSES a deterministic stub (never fabrication)", () => {
    assert.deepEqual(llmResultToSources(llmResult({ mode: "deterministic", provider: "deterministic" }), "q", 0, NOW), []);
  });

  it("REFUSES a fallback result, a null result, and an empty answer", () => {
    assert.deepEqual(llmResultToSources(llmResult({ mode: "fallback" }), "q", 0, NOW), []);
    assert.deepEqual(llmResultToSources(null, "q", 0, NOW), []);
    assert.deepEqual(llmResultToSources(llmResult({}, "   "), "q", 0, NOW), []);
  });
});

describe("gatherSources — boundary + arm gating", () => {
  const okFetcher: SourceFetcher = async (q, i) => llmResultToSources(llmResult(), q, i, NOW);

  it("refuses up front when the boundary denies network/LLM (fail-closed)", async () => {
    const closed: BoundaryDefinition = { stopConditions: ["stop"] }; // network/llm undefined ⇒ denied
    const r = await gatherSources(PLAN, { boundary: closed, fetcher: okFetcher, now: NOW, armed: true });
    assert.equal(r.refused, true);
    assert.equal(r.sources.length, 0);
    assert.ok(r.denials.length > 0);
  });

  it("fetches nothing when not armed (default), honestly", async () => {
    const r = await gatherSources(PLAN, { boundary: RESEARCH_AGENT_SPEC.boundary, fetcher: okFetcher, now: NOW });
    assert.equal(r.refused, false);
    assert.equal(r.sources.length, 0);
    assert.match(r.notes.join(" "), /not armed/);
  });

  it("gathers per sub-question when armed + boundary permits", async () => {
    const r = await gatherSources(PLAN, { boundary: RESEARCH_AGENT_SPEC.boundary, fetcher: okFetcher, now: NOW, armed: true });
    assert.equal(r.sources.length, PLAN.subQuestions.length);
    assert.equal(r.notes.length, PLAN.subQuestions.length);
  });

  it("a throwing fetcher becomes an honest note, never a fabricated source", async () => {
    const boom: SourceFetcher = async () => {
      throw new Error("network down");
    };
    const r = await gatherSources(PLAN, { boundary: RESEARCH_AGENT_SPEC.boundary, fetcher: boom, now: NOW, armed: true });
    assert.equal(r.sources.length, 0);
    assert.ok(r.notes.every((n) => /fetch failed/.test(n)));
  });
});
