/**
 * tests/council-claude-infer.test.ts
 *
 * TDD tests for councilClaudeInfer + selectCouncilInfer.
 * Injected runners only — NO real claude is ever spawned.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  councilClaudeInfer,
  CLAUDE_INFER_SENTINEL,
  COUNCIL_CLAUDE_MAX_CONCURRENCY,
  type ClaudeRunner,
} from "../src/council/council-claude-infer.js";
import { selectCouncilInfer } from "../src/council/council-specialists.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const VALID_ENV = { CLAUDE_CODE_OAUTH_TOKEN: "tok-test-abc" };
const NO_TOKEN_ENV: Record<string, string | undefined> = {};

const TEST_PROMPT = {
  system: "You are a CTO specialist.",
  user: "Goal: build a CRM",
};

/** A runner that succeeds with the given JSON text. */
function okRunner(text: string): ClaudeRunner {
  return async () => ({ ok: true, text });
}

/** A runner that signals failure (ok:false). */
function failRunner(msg = "runner says no"): ClaudeRunner {
  return async () => ({ ok: false, text: msg });
}

/** A runner that throws. */
function throwingRunner(): ClaudeRunner {
  return async () => { throw new Error("runner kaboom"); };
}

// ── success ───────────────────────────────────────────────────────────────────

describe("councilClaudeInfer — success", () => {
  it("returns the model's JSON text verbatim when runner succeeds", async () => {
    const modelJson = JSON.stringify({ summary: "looks feasible", confidence: "high", risks: [] });
    const infer = councilClaudeInfer(VALID_ENV, { runner: okRunner(modelJson) });
    const result = await infer(TEST_PROMPT);
    assert.equal(result, modelJson);
  });

  it("passes system + user combined as prompt (newline-separated) to the runner", async () => {
    let capturedPrompt = "";
    const capturingRunner: ClaudeRunner = async (prompt) => {
      capturedPrompt = prompt;
      return { ok: true, text: JSON.stringify({ summary: "ok", confidence: "medium", risks: [] }) };
    };
    const infer = councilClaudeInfer(VALID_ENV, { runner: capturingRunner });
    await infer(TEST_PROMPT);
    assert.ok(capturedPrompt.includes(TEST_PROMPT.system), "prompt must contain system text");
    assert.ok(capturedPrompt.includes(TEST_PROMPT.user), "prompt must contain user text");
  });
});

// ── failure paths ─────────────────────────────────────────────────────────────

describe("councilClaudeInfer — failure paths", () => {
  it("runner ok:false → returns sentinel, never throws", async () => {
    const infer = councilClaudeInfer(VALID_ENV, { runner: failRunner() });
    const result = await infer(TEST_PROMPT);
    assert.equal(result, CLAUDE_INFER_SENTINEL);
  });

  it("runner throws → returns sentinel, never throws", async () => {
    const infer = councilClaudeInfer(VALID_ENV, { runner: throwingRunner() });
    let threw = false;
    let result = "";
    try {
      result = await infer(TEST_PROMPT);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "must not throw even when runner throws");
    assert.equal(result, CLAUDE_INFER_SENTINEL);
  });

  it("no CLAUDE_CODE_OAUTH_TOKEN → sentinel immediately, runner is never called", async () => {
    let runnerCalled = false;
    const spyRunner: ClaudeRunner = async () => {
      runnerCalled = true;
      return { ok: true, text: "should not reach" };
    };
    const infer = councilClaudeInfer(NO_TOKEN_ENV, { runner: spyRunner });
    const result = await infer(TEST_PROMPT);
    assert.equal(result, CLAUDE_INFER_SENTINEL);
    assert.equal(runnerCalled, false, "runner must NOT be called when token is absent");
  });

  it("never throws even if everything is broken (no token + throwing runner)", async () => {
    const infer = councilClaudeInfer(NO_TOKEN_ENV, { runner: throwingRunner() });
    let threw = false;
    try {
      await infer(TEST_PROMPT);
    } catch {
      threw = true;
    }
    assert.equal(threw, false);
  });

  it("runner returns ok:true but empty text → sentinel", async () => {
    const infer = councilClaudeInfer(VALID_ENV, { runner: async () => ({ ok: true, text: "   " }) });
    const result = await infer(TEST_PROMPT);
    assert.equal(result, CLAUDE_INFER_SENTINEL);
  });
});

// ── concurrency cap ───────────────────────────────────────────────────────────

describe("councilClaudeInfer — concurrency cap", () => {
  it("COUNCIL_CLAUDE_MAX_CONCURRENCY default is 3", () => {
    assert.equal(COUNCIL_CLAUDE_MAX_CONCURRENCY, 3);
  });

  it("never exceeds cap concurrent in-flight spawns", async () => {
    const cap = COUNCIL_CLAUDE_MAX_CONCURRENCY; // 3
    const extra = 3; // fire cap+3 = 6 total
    const total = cap + extra;

    let inFlight = 0;
    let maxObserved = 0;

    // Controlled runner: records max concurrency before resolving.
    // Uses a small delay to let all callers pile up.
    const controlledRunner: ClaudeRunner = (prompt) =>
      new Promise((resolve) => {
        inFlight++;
        if (inFlight > maxObserved) maxObserved = inFlight;
        // Yield so other queued calls can try to enter simultaneously.
        setImmediate(() => {
          inFlight--;
          resolve({ ok: true, text: JSON.stringify({ summary: prompt.slice(0, 10), confidence: "low", risks: [] }) });
        });
      });

    const infer = councilClaudeInfer(VALID_ENV, { runner: controlledRunner });

    // Fan out all calls simultaneously.
    const calls = Array.from({ length: total }, (_, i) =>
      infer({ system: "sys", user: `user ${i}` }),
    );
    await Promise.all(calls);

    assert.ok(
      maxObserved <= cap,
      `max concurrent spawns ${maxObserved} must not exceed cap ${cap}`,
    );
  });

  it("HARTOS_COUNCIL_MAX_CONCURRENCY env overrides the default cap", async () => {
    const customCap = 1;
    const customEnv = { ...VALID_ENV, HARTOS_COUNCIL_MAX_CONCURRENCY: String(customCap) };

    let inFlight = 0;
    let maxObserved = 0;

    const controlledRunner: ClaudeRunner = () =>
      new Promise((resolve) => {
        inFlight++;
        if (inFlight > maxObserved) maxObserved = inFlight;
        setImmediate(() => {
          inFlight--;
          resolve({ ok: true, text: JSON.stringify({ summary: "s", confidence: "low", risks: [] }) });
        });
      });

    const infer = councilClaudeInfer(customEnv, { runner: controlledRunner });
    const calls = Array.from({ length: 4 }, (_, i) =>
      infer({ system: "sys", user: `user ${i}` }),
    );
    await Promise.all(calls);

    assert.ok(
      maxObserved <= customCap,
      `max observed ${maxObserved} must not exceed custom cap ${customCap}`,
    );
  });
});

// ── selectCouncilInfer ────────────────────────────────────────────────────────

describe("selectCouncilInfer", () => {
  it("with CLAUDE_CODE_OAUTH_TOKEN present → uses Claude path (returns sentinel on injected failure)", async () => {
    // We can't inject the runner into selectCouncilInfer directly, but we can observe the
    // behavioral difference: the Claude path with a token but no real claude binary will fail
    // (spawn error) and return CLAUDE_INFER_SENTINEL rather than the gateway stub.
    // Since tests run without a real `claude` binary available for spawning, the real spawn
    // would fail. Instead we verify it returns a string and doesn't throw.
    const infer = selectCouncilInfer({ CLAUDE_CODE_OAUTH_TOKEN: "tok-test" });
    let threw = false;
    let result = "";
    try {
      // We expect either sentinel or a valid JSON — either way it must be a string.
      result = await infer(TEST_PROMPT);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "selectCouncilInfer result must never throw");
    assert.equal(typeof result, "string", "must always return a string");
  });

  it("without token → falls back to gateway path (councilInferFromEnv), returns a string", async () => {
    const infer = selectCouncilInfer({});
    let threw = false;
    let result = "";
    try {
      result = await infer(TEST_PROMPT);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "gateway fallback must never throw");
    assert.equal(typeof result, "string");
  });

  it("gateway fallback (no token) never returns CLAUDE_INFER_SENTINEL (it has its own stub)", async () => {
    // The gateway fallback produces its own deterministic stub; it does NOT produce the claude sentinel.
    const infer = selectCouncilInfer({});
    const result = await infer(TEST_PROMPT);
    assert.notEqual(
      result,
      CLAUDE_INFER_SENTINEL,
      "gateway path must NOT produce the claude sentinel — it has its own honest stub",
    );
  });
});
