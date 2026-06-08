/**
 * tests/research-planner.test.ts — Phase F1.
 *
 * The deterministic research planner: shape detection, decomposition, required
 * inputs + risk heuristics, honest verdicts, and the anti-fabrication contract
 * (it plans + names unknowns; it never asserts findings). Pure + deterministic.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planResearch } from "../src/research/research-planner.js";

describe("research planner (Phase F1)", () => {
  it("strips a leading research verb and preserves the topic", () => {
    const p = planResearch("research a travel concierge product");
    assert.equal(p.question, "a travel concierge product");
    assert.equal(p.verdict, "READY_TO_RESEARCH");
  });

  it("detects research shapes deterministically", () => {
    assert.equal(planResearch("Notion vs Obsidian for notes").shape, "comparison");
    assert.equal(planResearch("should we build a tax agent?").shape, "decision");
    assert.equal(planResearch("what tools for habit tracking are out there").shape, "landscape");
    assert.equal(planResearch("how to deploy a Cloudflare Worker").shape, "howto");
    assert.equal(planResearch("what is a vector database").shape, "definition");
    assert.equal(planResearch("the carbon footprint of training large models").shape, "open");
  });

  it("decomposes into shape-appropriate sub-questions (no fabricated answers)", () => {
    const p = planResearch("should we build a travel concierge product?");
    assert.ok(p.subQuestions.length >= 4);
    // Every sub-question is a QUESTION, and every unknown ties back to one — answers
    // are explicitly ungathered, never invented.
    for (const s of p.subQuestions) assert.match(s, /\?$/);
    assert.equal(p.unknowns.length, p.subQuestions.length);
    for (const u of p.unknowns) assert.match(u, /Unanswered until sources are gathered:/);
  });

  it("derives required inputs + risk from signals in the question", () => {
    const p = planResearch("compare pricing and competitors for a travel concierge product");
    assert.ok(p.requiredInputs.includes("pricing / cost data"));
    assert.ok(p.requiredInputs.includes("competitor & market data"));
    assert.ok(p.requiredInputs.some((i) => /primary sources on/.test(i)));
    // legal/regulatory signals raise risk to high
    const legal = planResearch("what are the tax compliance requirements for invoicing in Malaysia?");
    assert.ok(legal.requiredInputs.includes("regulatory / legal sources"));
    assert.equal(legal.risk, "high");
  });

  it("risk: decisions are at least medium, definitions are low", () => {
    assert.equal(planResearch("should we migrate to a new database?").risk, "medium");
    assert.equal(planResearch("what is a vector database").risk, "low");
  });

  it("flags thin questions as NEEDS_SCOPING and broad ones as TOO_BROAD", () => {
    assert.equal(planResearch("research").verdict, "NEEDS_SCOPING");
    assert.equal(planResearch("ai").verdict, "NEEDS_SCOPING");
    assert.equal(planResearch("tell me everything about machine learning").verdict, "TOO_BROAD");
  });

  it("recommends a concrete next action grounded in the verdict", () => {
    const ready = planResearch("how to set up Trigger.dev for a Worker");
    assert.match(ready.recommendedNextAction, /Gather .*answer the sub-questions/i);
    const thin = planResearch("research");
    assert.match(thin.recommendedNextAction, /Clarify/i);
    const broad = planResearch("everything about distributed systems");
    assert.match(broad.recommendedNextAction, /Narrow the scope/i);
  });

  it("knowns describe structure only — never the answers", () => {
    const p = planResearch("compare Postgres and SQLite for an edge app");
    assert.ok(p.knowns.some((k) => /comparison-shaped/.test(k)));
    assert.ok(p.knowns.some((k) => /decomposes into/.test(k)));
    // no known claims to contain the actual answer
    for (const k of p.knowns) assert.ok(!/the answer is/i.test(k));
  });

  it("is deterministic — same question yields an identical plan", () => {
    const q = "should we build a research agent?";
    assert.deepEqual(planResearch(q), planResearch(q));
  });
});
