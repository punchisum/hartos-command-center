/**
 * tests/llm-output-validator.test.ts — Phase 11I. Output validation + safe reject.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateLlmOutput } from "../src/llm/output-validator.js";

const VALID = {
  intent: "finance_report",
  domain: "finance",
  confidence: "high",
  neededContext: ["watchlist", "market_data"],
  recommendedSpecialist: "finance_agent",
  riskLevel: "medium",
  nextAction: "generate_stock_watchlist_report",
  summary: "Hart is asking for a market data report across his watchlist.",
};

describe("llm output validator", () => {
  it("accepts a well-formed output", () => {
    const v = validateLlmOutput(VALID);
    assert.equal(v.ok, true);
    assert.equal(v.value?.domain, "finance");
  });

  it("rejects non-objects", () => {
    assert.equal(validateLlmOutput("nope").ok, false);
    assert.equal(validateLlmOutput(null).ok, false);
    assert.equal(validateLlmOutput([1, 2]).ok, false);
  });

  it("rejects missing keys", () => {
    const { confidence, ...rest } = VALID;
    void confidence;
    assert.equal(validateLlmOutput(rest).ok, false);
  });

  it("rejects invalid enum values", () => {
    assert.equal(validateLlmOutput({ ...VALID, confidence: "certain" }).ok, false);
    assert.equal(validateLlmOutput({ ...VALID, riskLevel: "nuclear" }).ok, false);
  });

  it("rejects domains outside the allowlist", () => {
    assert.equal(validateLlmOutput({ ...VALID, domain: "world_domination" }).ok, false);
    assert.equal(validateLlmOutput({ ...VALID, domain: "Finance" }).ok, false);
    for (const domain of ["finance", "fitness", "ops", "factory", "general"]) {
      assert.equal(validateLlmOutput({ ...VALID, domain }).ok, true);
    }
  });

  it("rejects token-like strings in fields", () => {
    const leaked = "key is sk-" + "a".repeat(28);
    assert.equal(validateLlmOutput({ ...VALID, summary: leaked }).ok, false);
  });

  it("rejects oversized strings and arrays", () => {
    assert.equal(validateLlmOutput({ ...VALID, intent: "x".repeat(1000) }).ok, false);
    assert.equal(validateLlmOutput({ ...VALID, neededContext: Array(50).fill("a") }).ok, false);
  });

  it("allows a longer summary than other fields (the synthesized answer), still bounded", () => {
    // summary has the larger MAX_SUMMARY_LENGTH ceiling so it is not forced below the
    // deterministic baseline it enriches; other 600-cap fields are unaffected.
    assert.equal(validateLlmOutput({ ...VALID, summary: "x".repeat(1500) }).ok, true);
    assert.equal(validateLlmOutput({ ...VALID, summary: "x".repeat(5000) }).ok, false);
  });
});
