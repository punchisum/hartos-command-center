/**
 * tests/llm-gemini-provider.test.ts — Gemini as primary, OpenAI as fallback.
 *
 * Verifies the provider chain (gemini → openai → deterministic), per-provider key/model
 * resolution, the fallback hop when Gemini errors/malforms, and that neither key leaks. No
 * real network: providers are injected mocks.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LlmGateway,
  resolveLlmConfig,
  selectProviderMode,
  providerChain,
  DEFAULT_GEMINI_MODEL,
} from "../src/llm/llm-gateway.js";
import { buildGeminiRequestBody } from "../src/llm/providers/gemini-provider.js";
import type { LlmProvider } from "../src/llm/llm-types.js";

const VALID = {
  intent: "ask",
  domain: "research",
  confidence: "medium",
  neededContext: [],
  recommendedSpecialist: "",
  riskLevel: "low",
  nextAction: "",
  summary: "the real substance",
};

function spy(name: "gemini" | "openai", impl: () => unknown): { provider: LlmProvider; calls: () => number } {
  let calls = 0;
  return {
    provider: { name, async generate() { calls += 1; return impl(); } },
    calls: () => calls,
  };
}

const GEMINI_ARMED = {
  HARTOS_LLM_PROVIDER: "gemini",
  HARTOS_LLM_ENABLE_NETWORK: "true",
  GEMINI_API_KEY: "test-gemini-key",
  OPENAI_API_KEY: "test-openai-key",
};

describe("gemini primary / openai fallback — config", () => {
  it("resolveLlmConfig: provider=gemini, primary model is the Gemini model, both key flags set", () => {
    const c = resolveLlmConfig(GEMINI_ARMED);
    assert.equal(c.provider, "gemini");
    assert.equal(c.model, DEFAULT_GEMINI_MODEL);
    assert.equal(c.geminiModel, DEFAULT_GEMINI_MODEL);
    assert.equal(c.geminiKeyPresent, true);
    assert.equal(c.openaiKeyPresent, true);
    assert.equal(c.apiKeyPresent, true); // primary (gemini) key present
    assert.equal(selectProviderMode(c), "gemini");
  });

  it("custom HARTOS_GEMINI_MODEL is honored", () => {
    const c = resolveLlmConfig({ ...GEMINI_ARMED, HARTOS_GEMINI_MODEL: "gemini-2.5-pro" });
    assert.equal(c.geminiModel, "gemini-2.5-pro");
    assert.equal(c.model, "gemini-2.5-pro");
  });

  it("providerChain is gemini→openai when gemini primary + both keys; gemini-only without openai key", () => {
    assert.deepEqual(providerChain(resolveLlmConfig(GEMINI_ARMED)), ["gemini", "openai"]);
    const noOpenai = resolveLlmConfig({ HARTOS_LLM_PROVIDER: "gemini", HARTOS_LLM_ENABLE_NETWORK: "true", GEMINI_API_KEY: "k" });
    assert.deepEqual(providerChain(noOpenai), ["gemini"]);
  });

  it("openai primary → openai→gemini chain (symmetric fallback when gemini key present)", () => {
    const c = resolveLlmConfig({ ...GEMINI_ARMED, HARTOS_LLM_PROVIDER: "openai" });
    assert.equal(c.provider, "openai");
    assert.equal(c.model, c.openaiModel); // primary model is the OpenAI model now
    assert.deepEqual(providerChain(c), ["openai", "gemini"]);
  });

  it("network gate off ⇒ empty chain ⇒ deterministic", () => {
    const c = resolveLlmConfig({ HARTOS_LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" });
    assert.deepEqual(providerChain(c), []);
    assert.equal(selectProviderMode(c), "deterministic");
  });

  it("never exposes either key in the resolved config", () => {
    const json = JSON.stringify(resolveLlmConfig(GEMINI_ARMED));
    assert.equal(json.includes("test-gemini-key"), false);
    assert.equal(json.includes("test-openai-key"), false);
  });
});

describe("gemini primary / openai fallback — gateway behavior", () => {
  it("calls Gemini first and returns a gemini-mode result when it is valid", async () => {
    const g = spy("gemini", () => VALID);
    const o = spy("openai", () => VALID);
    const gw = new LlmGateway({ env: GEMINI_ARMED, providers: { gemini: g.provider, openai: o.provider } });
    const r = await gw.classifyAndContextualize("compare two databases");
    assert.equal(r.provider, "gemini");
    assert.equal(r.mode, "gemini");
    assert.equal(r.model, DEFAULT_GEMINI_MODEL);
    assert.equal(g.calls(), 1);
    assert.equal(o.calls(), 0, "OpenAI must not be called when Gemini succeeds");
  });

  it("falls back to OpenAI when Gemini throws (e.g. 429)", async () => {
    const g = spy("gemini", () => { throw new Error("429"); });
    const o = spy("openai", () => VALID);
    const gw = new LlmGateway({ env: GEMINI_ARMED, providers: { gemini: g.provider, openai: o.provider } });
    const r = await gw.classifyAndContextualize("q");
    assert.equal(g.calls(), 1);
    assert.equal(o.calls(), 1);
    assert.equal(r.provider, "openai");
    assert.equal(r.mode, "openai");
    assert.equal(r.model, resolveLlmConfig(GEMINI_ARMED).openaiModel);
  });

  it("falls back to OpenAI when Gemini returns malformed output", async () => {
    const g = spy("gemini", () => ({ garbage: true }));
    const o = spy("openai", () => VALID);
    const gw = new LlmGateway({ env: GEMINI_ARMED, providers: { gemini: g.provider, openai: o.provider } });
    const r = await gw.classifyAndContextualize("q");
    assert.equal(r.provider, "openai");
    assert.equal(g.calls(), 1);
    assert.equal(o.calls(), 1);
  });

  it("when BOTH network providers fail ⇒ deterministic fallback (never crashes)", async () => {
    const g = spy("gemini", () => { throw new Error("boom"); });
    const o = spy("openai", () => ({ nope: true }));
    const gw = new LlmGateway({ env: GEMINI_ARMED, providers: { gemini: g.provider, openai: o.provider } });
    const r = await gw.classifyAndContextualize("q");
    assert.equal(g.calls(), 1);
    assert.equal(o.calls(), 1);
    assert.equal(r.provider, "deterministic");
    assert.equal(r.mode, "fallback");
    assert.equal(r.success, true);
  });

  it("does NOT call Gemini when the network gate is off", async () => {
    const g = spy("gemini", () => VALID);
    const gw = new LlmGateway({
      env: { HARTOS_LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" },
      providers: { gemini: g.provider },
    });
    const r = await gw.classifyAndContextualize("q");
    assert.equal(g.calls(), 0);
    assert.equal(r.provider, "deterministic");
  });
});

describe("gemini request body", () => {
  it("uses systemInstruction + user contents + JSON mime + temperature 0", () => {
    const cfg = resolveLlmConfig(GEMINI_ARMED);
    const body = buildGeminiRequestBody(cfg, { type: "classify_and_contextualize", request: "hi" }) as Record<string, any>;
    assert.ok(body.systemInstruction?.parts?.[0]?.text);
    assert.equal(body.contents[0].role, "user");
    assert.ok(body.contents[0].parts[0].text.length > 0);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(body.generationConfig.temperature, 0);
  });
});
