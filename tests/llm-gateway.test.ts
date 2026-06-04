/**
 * tests/llm-gateway.test.ts — Phase 11I.
 * Gateway defaults deterministic; OpenAI is never called unless the gate is on;
 * malformed provider output falls back safely. No network in tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LlmGateway } from "../src/llm/llm-gateway.js";
import type { LlmProvider } from "../src/llm/llm-types.js";

function spyProvider(impl: () => unknown): { provider: LlmProvider; calls: () => number } {
  let calls = 0;
  const provider: LlmProvider = {
    name: "openai",
    async generate() {
      calls += 1;
      return impl();
    },
  };
  return { provider, calls: () => calls };
}

const VALID = {
  intent: "finance_report",
  domain: "finance",
  confidence: "high",
  neededContext: ["watchlist"],
  recommendedSpecialist: "finance_agent",
  riskLevel: "medium",
  nextAction: "generate_report",
  summary: "A market data report.",
};

describe("llm gateway", () => {
  it("uses the deterministic provider by default", async () => {
    const spy = spyProvider(() => VALID);
    const gw = new LlmGateway({ env: {}, providers: { openai: spy.provider } });
    const r = await gw.classifyAndContextualize("Build me a finance agent");
    assert.equal(r.provider, "deterministic");
    assert.equal(r.mode, "deterministic");
    assert.equal(r.success, true);
    assert.equal(spy.calls(), 0, "openai must not be called by default");
  });

  it("does NOT call openai when network gate is off", async () => {
    const spy = spyProvider(() => VALID);
    const gw = new LlmGateway({
      env: { HARTOS_LLM_PROVIDER: "openai", OPENAI_API_KEY: "test-openai-key" },
      providers: { openai: spy.provider },
    });
    const r = await gw.classifyAndContextualize("hi");
    assert.equal(r.provider, "deterministic");
    assert.equal(spy.calls(), 0);
  });

  it("calls openai only when fully gated on, and validates output", async () => {
    const spy = spyProvider(() => VALID);
    const gw = new LlmGateway({
      env: { HARTOS_LLM_PROVIDER: "openai", HARTOS_LLM_ENABLE_NETWORK: "true", OPENAI_API_KEY: "test-openai-key" },
      providers: { openai: spy.provider },
    });
    const r = await gw.classifyAndContextualize("market report");
    assert.equal(r.provider, "openai");
    assert.equal(r.mode, "openai");
    assert.equal(spy.calls(), 1);
    assert.equal(r.output.domain, "finance");
  });

  it("falls back to deterministic on malformed openai output", async () => {
    const spy = spyProvider(() => ({ garbage: true }));
    const gw = new LlmGateway({
      env: { HARTOS_LLM_PROVIDER: "openai", HARTOS_LLM_ENABLE_NETWORK: "true", OPENAI_API_KEY: "test-openai-key" },
      providers: { openai: spy.provider },
    });
    const r = await gw.classifyAndContextualize("anything");
    assert.equal(spy.calls(), 1);
    assert.equal(r.provider, "deterministic");
    assert.equal(r.mode, "fallback");
    assert.equal(r.validation, "fallback");
    assert.equal(r.success, true);
  });

  it("falls back when openai provider throws (e.g. network error)", async () => {
    const spy = spyProvider(() => {
      throw new Error("boom");
    });
    const gw = new LlmGateway({
      env: { HARTOS_LLM_PROVIDER: "openai", HARTOS_LLM_ENABLE_NETWORK: "true", OPENAI_API_KEY: "test-openai-key" },
      providers: { openai: spy.provider },
    });
    const r = await gw.classifyAndContextualize("anything");
    assert.equal(r.mode, "fallback");
    assert.equal(r.success, true);
  });

  it("never leaks secret-like content into the structured output", async () => {
    const gw = new LlmGateway({ env: {} });
    const secret = "sk-" + "a".repeat(28);
    const r = await gw.summarizeAgentStatus(`token is ${secret}`);
    assert.ok(!r.output.summary.includes(secret));
  });
});
