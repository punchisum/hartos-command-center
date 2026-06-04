/**
 * tests/llm-provider-selection.test.ts — Phase 11I.
 * Default deterministic; OpenAI only with provider=openai + network gate + key.
 * Provider selection never exposes the key.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveLlmConfig, selectProviderMode } from "../src/llm/llm-gateway.js";

describe("llm provider selection", () => {
  it("defaults to deterministic with no env", () => {
    const config = resolveLlmConfig({});
    assert.equal(config.provider, "deterministic");
    assert.equal(selectProviderMode(config), "deterministic");
  });

  it("stays deterministic when openai requested but network gate is off", () => {
    const config = resolveLlmConfig({ HARTOS_LLM_PROVIDER: "openai", OPENAI_API_KEY: "test-openai-key" });
    assert.equal(config.provider, "openai");
    assert.equal(config.networkEnabled, false);
    assert.equal(selectProviderMode(config), "deterministic");
  });

  it("stays deterministic when network gate on but no key", () => {
    const config = resolveLlmConfig({ HARTOS_LLM_PROVIDER: "openai", HARTOS_LLM_ENABLE_NETWORK: "true" });
    assert.equal(config.apiKeyPresent, false);
    assert.equal(selectProviderMode(config), "deterministic");
  });

  it("selects openai only when provider+gate+key all present", () => {
    const config = resolveLlmConfig({
      HARTOS_LLM_PROVIDER: "openai",
      HARTOS_LLM_ENABLE_NETWORK: "true",
      OPENAI_API_KEY: "test-openai-key",
      HARTOS_LLM_MODEL: "gpt-4o-mini",
    });
    assert.equal(selectProviderMode(config), "openai");
  });

  it("never exposes the api key in the resolved config", () => {
    const config = resolveLlmConfig({ OPENAI_API_KEY: "supersecretvalue1234567890" });
    assert.equal(config.apiKeyPresent, true);
    assert.equal(JSON.stringify(config).includes("supersecret"), false);
  });
});
