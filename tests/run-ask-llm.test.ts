/**
 * tests/run-ask-llm.test.ts — LLM ASK 2A (Node/Edge runner).
 *
 * buildAskInfer() constructs a production AskInfer from the governed LlmGateway.
 * HERMETIC: env + providers are injected; a mock openai provider stands in for
 * any real network so NO real call ever occurs. By default the gate is closed,
 * so the runner stays deterministic and the openai mock is NOT invoked.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAskInfer } from "../src/llm/run-ask-llm.js";
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

describe("run-ask-llm runner", () => {
  it("returns an LlmResult for a redacted request (default deterministic)", async () => {
    const infer = buildAskInfer({ env: {} });
    const result = await infer("Build me a finance agent", { surface: "ask" });
    assert.ok(result, "expected a non-null LlmResult");
    assert.equal(result?.success, true);
    assert.equal(result?.requestType, "classify_and_contextualize");
    assert.ok(typeof result?.output.summary === "string");
  });

  it("stays deterministic and makes NO network call when the gate is closed", async () => {
    const spy = spyProvider(() => VALID);
    const infer = buildAskInfer({ env: {}, providers: { openai: spy.provider } });
    const result = await infer("anything", {});
    assert.ok(result);
    assert.equal(result?.provider, "deterministic");
    assert.equal(result?.mode, "deterministic");
    assert.equal(spy.calls(), 0, "openai mock must not be invoked when gate is closed");
  });

  it("does NOT call openai when provider=openai but network gate is off", async () => {
    const spy = spyProvider(() => VALID);
    const infer = buildAskInfer({
      env: { HARTOS_LLM_PROVIDER: "openai", OPENAI_API_KEY: "test-openai-key" },
      providers: { openai: spy.provider },
    });
    const result = await infer("hi");
    assert.equal(result?.provider, "deterministic");
    assert.equal(spy.calls(), 0);
  });

  it("uses the injected openai mock only when the gate is fully open", async () => {
    const spy = spyProvider(() => VALID);
    const infer = buildAskInfer({
      env: {
        HARTOS_LLM_PROVIDER: "openai",
        HARTOS_LLM_ENABLE_NETWORK: "true",
        OPENAI_API_KEY: "test-openai-key",
      },
      providers: { openai: spy.provider },
    });
    const result = await infer("market report");
    assert.equal(result?.provider, "openai");
    assert.equal(result?.mode, "openai");
    assert.equal(spy.calls(), 1, "mock provider stands in for the real network");
    assert.equal(result?.output.domain, "finance");
  });

  it("never throws — returns a safe result even when the openai provider errors", async () => {
    const spy = spyProvider(() => {
      throw new Error("boom");
    });
    const infer = buildAskInfer({
      env: {
        HARTOS_LLM_PROVIDER: "openai",
        HARTOS_LLM_ENABLE_NETWORK: "true",
        OPENAI_API_KEY: "test-openai-key",
      },
      providers: { openai: spy.provider },
    });
    const result = await infer("anything");
    // Gateway absorbs the provider error into a deterministic fallback (success=true).
    assert.ok(result);
    assert.equal(result?.mode, "fallback");
    assert.equal(result?.success, true);
  });

  it("returns null (not throw) when an injected gateway itself rejects", async () => {
    const throwingGateway = {
      async classifyAndContextualize(): Promise<never> {
        throw new Error("gateway exploded");
      },
    } as unknown as import("../src/llm/llm-gateway.js").LlmGateway;
    const infer = buildAskInfer({ gateway: throwingGateway });
    const result = await infer("anything");
    assert.equal(result, null);
  });
});
