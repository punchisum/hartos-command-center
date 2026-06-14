/**
 * tests/claude-max-provider.test.ts
 *
 * TDD tests for:
 *   1. claude-max provider (buildClaudeMaxProvider with injected fake runner)
 *   2. gateway with extraProviders:{ "claude-max": fake } — chain order, fallback.
 *
 * No real child processes are ever spawned. All runners are hermetic fakes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildClaudeMaxProvider,
  CLAUDE_MAX_DEFAULT_CONCURRENCY,
  type ClaudeMaxRunner,
} from "../src/llm/providers/claude-max-provider.js";
import { LlmGateway, providerChain } from "../src/llm/llm-gateway.js";
import type { LlmProvider } from "../src/llm/llm-types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_8FIELD = {
  intent: "classify",
  domain: "general",
  confidence: "medium",
  neededContext: [],
  recommendedSpecialist: "",
  riskLevel: "low",
  nextAction: "",
  summary: "Claude-Max answered this.",
};

const VALID_ENV = { CLAUDE_CODE_OAUTH_TOKEN: "tok-test-oauth" };

/** Runner that returns valid 8-field JSON. */
function okRunner(payload: unknown = VALID_8FIELD): ClaudeMaxRunner {
  return async () => ({ ok: true, text: JSON.stringify(payload) });
}

/** Runner that returns ok:true but invalid JSON text. */
function badJsonRunner(): ClaudeMaxRunner {
  return async () => ({ ok: true, text: "not-json{{}}" });
}

/** Runner that returns ok:false (is_error or spawn failure). */
function failRunner(msg = "spawn-fail"): ClaudeMaxRunner {
  return async () => ({ ok: false, text: msg });
}

/** Runner that throws. */
function throwRunner(): ClaudeMaxRunner {
  return async () => { throw new Error("runner-boom"); };
}

// ── Provider: success ─────────────────────────────────────────────────────────

describe("claude-max provider — success", () => {
  it("returns parsed 8-field output when runner succeeds", async () => {
    // Simulate CLAUDE_CODE_OAUTH_TOKEN in process.env for the duration of this test.
    const saved = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
    process.env["CLAUDE_CODE_OAUTH_TOKEN"] = "tok-test-abc";
    try {
      const provider = buildClaudeMaxProvider(okRunner());
      const raw = await provider.generate(
        { type: "classify_and_contextualize", request: "hello" },
        { provider: "claude-max", model: "sonnet", networkEnabled: true, apiKeyPresent: false },
      );
      assert.deepEqual(raw, VALID_8FIELD);
    } finally {
      if (saved === undefined) delete process.env["CLAUDE_CODE_OAUTH_TOKEN"];
      else process.env["CLAUDE_CODE_OAUTH_TOKEN"] = saved;
    }
  });

  it("passes the combined system+user prompt to the runner", async () => {
    const saved = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
    process.env["CLAUDE_CODE_OAUTH_TOKEN"] = "tok-test-abc";
    let capturedPrompt = "";
    const capturingRunner: ClaudeMaxRunner = async (prompt) => {
      capturedPrompt = prompt;
      return { ok: true, text: JSON.stringify(VALID_8FIELD) };
    };
    try {
      const provider = buildClaudeMaxProvider(capturingRunner);
      await provider.generate(
        { type: "classify_and_contextualize", request: "test-request-text" },
        { provider: "claude-max", model: "sonnet", networkEnabled: true, apiKeyPresent: false },
      );
      assert.ok(capturedPrompt.length > 0, "prompt must be non-empty");
      assert.ok(capturedPrompt.includes("test-request-text"), "prompt must contain the request");
    } finally {
      if (saved === undefined) delete process.env["CLAUDE_CODE_OAUTH_TOKEN"];
      else process.env["CLAUDE_CODE_OAUTH_TOKEN"] = saved;
    }
  });

  it("provider name is 'claude-max'", () => {
    const provider = buildClaudeMaxProvider(okRunner());
    assert.equal(provider.name, "claude-max");
  });
});

// ── Provider: failure paths — must THROW so the gateway falls back ────────────

describe("claude-max provider — throws on failure (gateway falls back)", () => {
  it("throws when CLAUDE_CODE_OAUTH_TOKEN is absent", async () => {
    const saved = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
    delete process.env["CLAUDE_CODE_OAUTH_TOKEN"];
    try {
      const provider = buildClaudeMaxProvider(okRunner());
      await assert.rejects(
        () => provider.generate(
          { type: "classify_and_contextualize", request: "hi" },
          { provider: "claude-max", model: "sonnet", networkEnabled: true, apiKeyPresent: false },
        ),
        /CLAUDE_CODE_OAUTH_TOKEN/,
      );
    } finally {
      if (saved !== undefined) process.env["CLAUDE_CODE_OAUTH_TOKEN"] = saved;
    }
  });

  it("throws when runner returns ok:false (spawn / is_error)", async () => {
    const saved = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
    process.env["CLAUDE_CODE_OAUTH_TOKEN"] = "tok-test";
    try {
      const provider = buildClaudeMaxProvider(failRunner());
      await assert.rejects(
        () => provider.generate(
          { type: "classify_and_contextualize", request: "hi" },
          { provider: "claude-max", model: "sonnet", networkEnabled: true, apiKeyPresent: false },
        ),
        /spawn returned failure/,
      );
    } finally {
      if (saved === undefined) delete process.env["CLAUDE_CODE_OAUTH_TOKEN"];
      else process.env["CLAUDE_CODE_OAUTH_TOKEN"] = saved;
    }
  });

  it("throws when runner returns ok:true but non-JSON text", async () => {
    const saved = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
    process.env["CLAUDE_CODE_OAUTH_TOKEN"] = "tok-test";
    try {
      const provider = buildClaudeMaxProvider(badJsonRunner());
      await assert.rejects(
        () => provider.generate(
          { type: "classify_and_contextualize", request: "hi" },
          { provider: "claude-max", model: "sonnet", networkEnabled: true, apiKeyPresent: false },
        ),
        /not valid JSON/,
      );
    } finally {
      if (saved === undefined) delete process.env["CLAUDE_CODE_OAUTH_TOKEN"];
      else process.env["CLAUDE_CODE_OAUTH_TOKEN"] = saved;
    }
  });

  it("throws when runner itself throws", async () => {
    const saved = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
    process.env["CLAUDE_CODE_OAUTH_TOKEN"] = "tok-test";
    try {
      const provider = buildClaudeMaxProvider(throwRunner());
      await assert.rejects(
        () => provider.generate(
          { type: "classify_and_contextualize", request: "hi" },
          { provider: "claude-max", model: "sonnet", networkEnabled: true, apiKeyPresent: false },
        ),
        /runner-boom/,
      );
    } finally {
      if (saved === undefined) delete process.env["CLAUDE_CODE_OAUTH_TOKEN"];
      else process.env["CLAUDE_CODE_OAUTH_TOKEN"] = saved;
    }
  });
});

// ── Provider: concurrency cap ──────────────────────────────────────────────────

describe("claude-max provider — concurrency cap", () => {
  it("default concurrency cap is 3", () => {
    assert.equal(CLAUDE_MAX_DEFAULT_CONCURRENCY, 3);
  });

  it("never exceeds cap concurrent in-flight spawns", async () => {
    const saved = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
    process.env["CLAUDE_CODE_OAUTH_TOKEN"] = "tok-test";
    const cap = 2;
    let inFlight = 0;
    let maxObserved = 0;

    const controlledRunner: ClaudeMaxRunner = () =>
      new Promise((resolve) => {
        inFlight++;
        if (inFlight > maxObserved) maxObserved = inFlight;
        setImmediate(() => {
          inFlight--;
          resolve({ ok: true, text: JSON.stringify(VALID_8FIELD) });
        });
      });

    try {
      const provider = buildClaudeMaxProvider(controlledRunner, { concurrencyCap: cap });
      const config = { provider: "claude-max" as const, model: "sonnet", networkEnabled: true, apiKeyPresent: false };
      const req = { type: "classify_and_contextualize" as const, request: "hi" };

      const calls = Array.from({ length: cap + 3 }, () => provider.generate(req, config));
      await Promise.all(calls);

      assert.ok(
        maxObserved <= cap,
        `max concurrent ${maxObserved} must not exceed cap ${cap}`,
      );
    } finally {
      if (saved === undefined) delete process.env["CLAUDE_CODE_OAUTH_TOKEN"];
      else process.env["CLAUDE_CODE_OAUTH_TOKEN"] = saved;
    }
  });
});

// ── Gateway integration: extraProviders + provider:"claude-max" ───────────────

describe("gateway with claude-max extraProviders", () => {
  function makeClaudeMaxFake(impl: () => unknown): LlmProvider {
    return {
      name: "claude-max",
      async generate() { return impl(); },
    };
  }

  it("uses claude-max first when provider:claude-max + extraProviders wired", async () => {
    let claudeMaxCalled = 0;
    const fake = makeClaudeMaxFake(() => { claudeMaxCalled++; return VALID_8FIELD; });

    const gw = new LlmGateway({
      config: { provider: "claude-max", model: "sonnet", networkEnabled: false, apiKeyPresent: false },
      extraProviders: { "claude-max": fake },
    });
    const r = await gw.classifyAndContextualize("test request");
    assert.equal(claudeMaxCalled, 1, "claude-max provider must be called");
    assert.equal(r.provider, "claude-max");
    assert.equal(r.mode, "claude-max");
    assert.equal(r.success, true);
    assert.equal(r.output.domain, "general");
  });

  it("falls back to gemini when claude-max throws", async () => {
    let geminiFakeCallCount = 0;
    const claudeMaxFake = makeClaudeMaxFake(() => { throw new Error("no token"); });
    const geminiFake: LlmProvider = {
      name: "gemini",
      async generate() { geminiFakeCallCount++; return VALID_8FIELD; },
    };

    const gw = new LlmGateway({
      config: {
        provider: "claude-max",
        model: "sonnet",
        networkEnabled: true,
        apiKeyPresent: false,
        geminiKeyPresent: true,
        geminiModel: "gemini-2.5-flash-lite",
      },
      extraProviders: { "claude-max": claudeMaxFake },
      providers: { gemini: geminiFake },
    });
    const r = await gw.classifyAndContextualize("fallback test");
    assert.equal(geminiFakeCallCount, 1, "gemini fallback must be called");
    assert.equal(r.provider, "gemini");
    assert.equal(r.success, true);
  });

  it("falls back to deterministic when claude-max throws and no gemini/openai keys", async () => {
    const claudeMaxFake = makeClaudeMaxFake(() => { throw new Error("no token"); });

    const gw = new LlmGateway({
      config: {
        provider: "claude-max",
        model: "sonnet",
        networkEnabled: false,
        apiKeyPresent: false,
        geminiKeyPresent: false,
        openaiKeyPresent: false,
      },
      extraProviders: { "claude-max": claudeMaxFake },
    });
    const r = await gw.classifyAndContextualize("final fallback");
    assert.equal(r.provider, "deterministic");
    assert.equal(r.success, true);
  });

  it("falls back to deterministic when claude-max returns malformed output", async () => {
    const claudeMaxFake = makeClaudeMaxFake(() => ({ garbage: true }));

    const gw = new LlmGateway({
      config: {
        provider: "claude-max",
        model: "sonnet",
        networkEnabled: false,
        apiKeyPresent: false,
      },
      extraProviders: { "claude-max": claudeMaxFake },
    });
    const r = await gw.classifyAndContextualize("bad output test");
    assert.equal(r.provider, "deterministic");
    assert.equal(r.mode, "fallback");
    assert.equal(r.success, true);
  });

  it("does NOT include claude-max in chain when extraProviders is absent", () => {
    // Verify providerChain never includes claude-max when not injected.
    const config = { provider: "claude-max" as const, model: "sonnet", networkEnabled: true, apiKeyPresent: false, geminiKeyPresent: true };
    const chain = providerChain(config, { claudeMaxPresent: false });
    assert.ok(!chain.includes("claude-max"), "claude-max must not appear when not injected");
    assert.ok(chain.includes("gemini"), "gemini fallback should still appear");
  });

  it("gateway defaults (no extraProviders) never reach claude-max code path", async () => {
    // Even with provider:claude-max in config, without extraProviders the chain produces no
    // claude-max slot → falls to deterministic. No node:child_process is touched.
    const gw = new LlmGateway({
      config: {
        provider: "claude-max",
        model: "sonnet",
        networkEnabled: false,
        apiKeyPresent: false,
      },
      // No extraProviders — this is what the Worker does.
    });
    const r = await gw.classifyAndContextualize("worker path");
    assert.equal(r.provider, "deterministic");
    assert.equal(r.success, true);
  });

  it("providers mock still overrides extraProviders (test mock wins)", async () => {
    // Ensures the merge order: providers (test mocks) take precedence over extraProviders.
    let extraCalled = false;
    let mockCalled = false;
    const extraFake = makeClaudeMaxFake(() => { extraCalled = true; return VALID_8FIELD; });
    const mockFake: LlmProvider = {
      name: "claude-max",
      async generate() { mockCalled = true; return VALID_8FIELD; },
    };

    const gw = new LlmGateway({
      config: { provider: "claude-max", model: "sonnet", networkEnabled: false, apiKeyPresent: false },
      extraProviders: { "claude-max": extraFake },
      providers: { "claude-max": mockFake },
    });
    await gw.classifyAndContextualize("mock test");
    assert.equal(mockCalled, true, "providers mock must win over extraProviders");
    assert.equal(extraCalled, false, "extra provider must NOT be called when mock overrides it");
  });
});

// ── providerChain: claude-max ordering ───────────────────────────────────────

describe("providerChain — claude-max ordering", () => {
  it("claude-max → gemini → openai when all present", () => {
    const config = {
      provider: "claude-max" as const,
      model: "sonnet",
      networkEnabled: true,
      apiKeyPresent: false,
      geminiKeyPresent: true as const,
      openaiKeyPresent: true as const,
    };
    const chain = providerChain(config, { claudeMaxPresent: true });
    assert.deepEqual(chain, ["claude-max", "gemini", "openai"]);
  });

  it("claude-max → gemini when openai key absent", () => {
    const config = {
      provider: "claude-max" as const,
      model: "sonnet",
      networkEnabled: true,
      apiKeyPresent: false,
      geminiKeyPresent: true as const,
      openaiKeyPresent: false as const,
    };
    const chain = providerChain(config, { claudeMaxPresent: true });
    assert.deepEqual(chain, ["claude-max", "gemini"]);
  });

  it("claude-max only when no gemini/openai keys", () => {
    const config = {
      provider: "claude-max" as const,
      model: "sonnet",
      networkEnabled: false,
      apiKeyPresent: false,
    };
    const chain = providerChain(config, { claudeMaxPresent: true });
    assert.deepEqual(chain, ["claude-max"]);
  });

  it("empty chain when provider:claude-max but claudeMaxPresent:false and no keys", () => {
    const config = {
      provider: "claude-max" as const,
      model: "sonnet",
      networkEnabled: false,
      apiKeyPresent: false,
    };
    const chain = providerChain(config, { claudeMaxPresent: false });
    assert.deepEqual(chain, []);
  });

  it("gemini→openai chain is UNCHANGED when provider:gemini (no claude-max leakage)", () => {
    const config = {
      provider: "gemini" as const,
      model: "gemini-2.5-flash-lite",
      networkEnabled: true,
      apiKeyPresent: true,
      geminiKeyPresent: true as const,
      openaiKeyPresent: true as const,
    };
    const chain = providerChain(config, { claudeMaxPresent: true });
    assert.deepEqual(chain, ["gemini", "openai"]);
  });
});
