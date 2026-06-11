/**
 * tests/llm-organism-p0.test.ts — Live Organism Patch P0: the two live-bug fixes.
 *   A) deterministic classifier is honest (war/economy ≠ fitness; zero-match ⇒ general).
 *   B) the gate decision is explainable, and the Ask never launders a non-LLM answer as "LLM used".
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyDomain, deterministicOutput } from "../src/llm/providers/deterministic-provider.js";
import { explainGate } from "../src/llm/llm-gateway.js";
import { composeAskAnswer, type AskGrounding, type AskInfer } from "../src/llm/ask-llm.js";
import type { LlmGatewayConfig, LlmResult, LlmStructuredOutput } from "../src/llm/llm-types.js";

const GROUNDING: AskGrounding = { summary: "deterministic truth", title: "T", highlights: ["h"], gaps: ["g"] };

function cfg(over: Partial<LlmGatewayConfig> = {}): LlmGatewayConfig {
  return { provider: "openai", model: "gpt-5.5", networkEnabled: true, apiKeyPresent: true, ...over };
}
const VALID_OUTPUT: LlmStructuredOutput = {
  intent: "ask", domain: "research", confidence: "medium", neededContext: [],
  recommendedSpecialist: "", riskLevel: "low", nextAction: "", summary: "the real substance",
};
function llmResult(over: Partial<LlmResult> = {}): LlmResult {
  return { output: VALID_OUTPUT, provider: "openai", model: "gpt-5.5", mode: "openai", validation: "valid", success: true, requestType: "classify_and_contextualize", ...over };
}

describe("P0-A classifyDomain — honest, request-only", () => {
  it("does NOT classify a war/economy question as fitness", () => {
    const c = classifyDomain("what are the market opportunities from the war economy");
    assert.notEqual(c.domain, "fitness");
    assert.equal(c.domain, "finance"); // 'market' matches finance
    assert.ok(c.score > 0);
  });
  it("classifies a real fitness question as fitness", () => {
    assert.equal(classifyDomain("my workout recovery and sleep").domain, "fitness");
  });
  it("zero-match ⇒ general/orchestrator at score 0 (never a falsely-asserted specialist)", () => {
    const c = classifyDomain("tell me about the geopolitical situation");
    assert.equal(c.domain, "general");
    assert.equal(c.specialist, "orchestrator");
    assert.equal(c.score, 0);
    assert.deepEqual(c.matched, []);
  });

  it("REGRESSION (the real bug): deterministicOutput does NOT fold fitness-heavy grounding context into the domain", () => {
    // The original bug: deterministicOutput classified over request + JSON.stringify(context),
    // and the Ask grounding is full of fitness/ops panel data → a war/economy question scored fitness.
    const out = deterministicOutput({
      type: "classify_and_contextualize",
      request: "what are the market opportunities from the war economy",
      context: { grounding: { summary: "Training/recovery: HRV low, sleep 8.5h, workout done", highlights: ["fitness recovery nutrition training sleep hrv whoop"] } },
    });
    assert.notEqual(out.domain, "fitness", "must NOT be fitness — that was the bug");
    assert.equal(out.domain, "finance"); // from the REQUEST ('market'), not the fitness context
  });
});

describe("P0-B explainGate — the gate is never a silent mystery", () => {
  it("gives the EXACT, actionable reason for each disarmed branch + armed", () => {
    assert.equal(explainGate(cfg({ provider: "deterministic" })).reason, 'provider is "deterministic" (set HARTOS_LLM_PROVIDER=gemini or openai)');
    assert.equal(explainGate(cfg({ networkEnabled: false })).reason, "network disabled (set HARTOS_LLM_ENABLE_NETWORK=true)");
    assert.equal(explainGate(cfg({ apiKeyPresent: false })).reason, "OPENAI_API_KEY not present in env");
    const armed = explainGate(cfg());
    assert.equal(armed.mode, "openai");
    assert.equal(armed.reason, "armed");
  });
});

describe("P0-B composeAskAnswer — honest fallbackReason, no laundering", () => {
  it("no infer ⇒ disarmed", async () => {
    const a = await composeAskAnswer(GROUNDING, "q", undefined, {});
    assert.equal(a.usedLlm, false);
    assert.equal(a.fallbackReason, "disarmed");
  });
  it("infer throws ⇒ infer-threw", async () => {
    const infer: AskInfer = async () => { throw new Error("network down"); };
    const a = await composeAskAnswer(GROUNDING, "q", undefined, { infer });
    assert.equal(a.fallbackReason, "infer-threw");
    assert.equal(a.usedLlm, false);
  });
  it("infer returns null ⇒ disarmed", async () => {
    const a = await composeAskAnswer(GROUNDING, "q", undefined, { infer: async () => null });
    assert.equal(a.fallbackReason, "disarmed");
  });
  it("malformed LLM output ⇒ malformed-output (not laundered)", async () => {
    const infer: AskInfer = async () => llmResult({ output: { bogus: true } as unknown as LlmStructuredOutput });
    const a = await composeAskAnswer(GROUNDING, "q", undefined, { infer });
    assert.equal(a.fallbackReason, "malformed-output");
    assert.equal(a.usedLlm, false);
  });
  it("a real openai result ⇒ usedLlm true, fallbackReason none", async () => {
    const a = await composeAskAnswer(GROUNDING, "q", undefined, { infer: async () => llmResult() });
    assert.equal(a.usedLlm, true);
    assert.equal(a.mode, "llm");
    assert.equal(a.fallbackReason, "none");
    assert.equal(a.summary, "the real substance");
  });
  it("a gateway-internal deterministic result is NOT laundered as LLM-used", async () => {
    const infer: AskInfer = async () => llmResult({ provider: "deterministic", mode: "deterministic" });
    const a = await composeAskAnswer(GROUNDING, "q", undefined, { infer });
    assert.equal(a.usedLlm, false);
    assert.equal(a.mode, "deterministic");
    assert.equal(a.fallbackReason, "disarmed");
  });
});
