/**
 * tests/ask-intent-routing.test.ts
 *
 * Intent-specialized reasoning: buildAskInfer routes a strategy question to the gateway's
 * runStrategyReasoning and a build/CTO question to runCtoReasoning, and buildSystemPrompt adds the
 * matching role so the model reasons as a strategist / CTO instead of the generic classifier voice.
 * Hermetic: a fake gateway records which capability was invoked; no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAskInfer } from "../src/llm/run-ask-llm.js";
import { buildSystemPrompt } from "../src/llm/prompt-contracts.js";
import type { LlmGateway } from "../src/llm/llm-gateway.js";
import type { LlmResult } from "../src/llm/llm-types.js";

function fakeGateway() {
  const calls: string[] = [];
  const ok = (requestType: LlmResult["requestType"]): Promise<LlmResult> =>
    Promise.resolve({
      output: {
        intent: "x",
        domain: "system",
        confidence: "low",
        neededContext: [],
        recommendedSpecialist: "",
        riskLevel: "low",
        nextAction: "",
        summary: "ok",
      },
      provider: "deterministic",
      model: "test",
      mode: "deterministic",
      validation: "valid",
      success: true,
      requestType,
    });
  return {
    calls,
    classifyAndContextualize: (_r: string, _c?: Record<string, unknown>) => {
      calls.push("classify");
      return ok("classify_and_contextualize");
    },
    runStrategyReasoning: (_r: string, _c?: Record<string, unknown>) => {
      calls.push("strategy");
      return ok("strategy_reasoning");
    },
    runCtoReasoning: (_r: string, _c?: Record<string, unknown>) => {
      calls.push("cto");
      return ok("cto_reasoning");
    },
  };
}

describe("buildAskInfer — intent-specialized routing", () => {
  it("routes a strategy_review intent to runStrategyReasoning", async () => {
    const g = fakeGateway();
    const infer = buildAskInfer({ gateway: g as unknown as LlmGateway });
    await infer("redacted", { intent: "strategy_review" });
    assert.deepEqual(g.calls, ["strategy"]);
  });

  it("routes a build_agent intent to runCtoReasoning", async () => {
    const g = fakeGateway();
    const infer = buildAskInfer({ gateway: g as unknown as LlmGateway });
    await infer("redacted", { intent: "build_agent" });
    assert.deepEqual(g.calls, ["cto"]);
  });

  it("defaults to classifyAndContextualize for other or absent intents", async () => {
    const g = fakeGateway();
    const infer = buildAskInfer({ gateway: g as unknown as LlmGateway });
    await infer("redacted", { intent: "ops_status" });
    await infer("redacted", {});
    await infer("redacted");
    assert.deepEqual(g.calls, ["classify", "classify", "classify"]);
  });
});

describe("buildSystemPrompt — role specialization", () => {
  it("adds the STRATEGY role for strategy_reasoning", () => {
    assert.match(buildSystemPrompt("strategy_reasoning"), /STRATEGY advisor/);
  });

  it("adds the CTO role for cto_reasoning", () => {
    assert.match(buildSystemPrompt("cto_reasoning"), /Reason as Hart's CTO/);
  });

  it("is unchanged (no ROLE clause) for the default classify type", () => {
    const base = buildSystemPrompt();
    assert.ok(!/ROLE:/.test(base), "base prompt carries no role clause");
    assert.equal(buildSystemPrompt("classify_and_contextualize"), base, "classify type == base");
  });
});
