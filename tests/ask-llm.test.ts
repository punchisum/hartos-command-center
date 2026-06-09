/**
 * tests/ask-llm.test.ts — LLM ASK plan 2A.
 *
 * The Worker-safe Ask-LLM orchestrator: deterministic by default, LLM-enriched
 * (and grounded) only when an AskInfer is injected, redact-FIRST so a planted
 * secret never reaches infer, honest deterministic fallback on null/throw/
 * invalid output, propose-only always, and deterministic. No network/fs/clock.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeAskAnswer } from "../src/llm/ask-llm.js";
import type { AskGrounding, AskInfer } from "../src/llm/ask-llm.js";
import type { LlmResult, LlmStructuredOutput } from "../src/llm/llm-types.js";

const GROUNDING: AskGrounding = {
  title: "Command Brief",
  summary: "Command Brief: ops is stale, fitness is fresh.",
  highlights: ["ops: stale (4h)", "fitness: fresh"],
  gaps: ["ops freshness unknown beyond 4h"],
};

const VALID_OUTPUT: LlmStructuredOutput = {
  intent: "daily_brief",
  domain: "ops",
  confidence: "high",
  neededContext: ["live ops panel"],
  recommendedSpecialist: "ops_agent",
  riskLevel: "medium",
  nextAction: "review ops staleness",
  summary: "LLM reasoning: ops needs a refresh; fitness is healthy.",
};

function validResult(output: LlmStructuredOutput = VALID_OUTPUT): LlmResult {
  return {
    output,
    provider: "openai",
    model: "gpt-test",
    mode: "openai",
    validation: "valid",
    success: true,
    requestType: "summarize_cockpit_state",
  };
}

/** A fake infer that records the args it was called with. */
function spyInfer(result: LlmResult | null): {
  infer: AskInfer;
  calls: () => number;
  lastRequest: () => string | undefined;
  lastContext: () => Record<string, unknown> | undefined;
} {
  let calls = 0;
  let lastRequest: string | undefined;
  let lastContext: Record<string, unknown> | undefined;
  const infer: AskInfer = async (redactedRequest, context) => {
    calls += 1;
    lastRequest = redactedRequest;
    lastContext = context;
    return result;
  };
  return {
    infer,
    calls: () => calls,
    lastRequest: () => lastRequest,
    lastContext: () => lastContext,
  };
}

describe("composeAskAnswer", () => {
  it("no infer → deterministic answer with fields == grounding", async () => {
    const a = await composeAskAnswer(GROUNDING, "what needs my attention?", undefined, {});
    assert.equal(a.mode, "deterministic");
    assert.equal(a.provider, "deterministic");
    assert.equal(a.usedLlm, false);
    assert.equal(a.proposeOnly, true);
    assert.equal(a.title, GROUNDING.title);
    assert.equal(a.summary, GROUNDING.summary);
    assert.deepEqual(a.highlights, GROUNDING.highlights);
    assert.deepEqual(a.gaps, GROUNDING.gaps);
    assert.equal(a.validation, "deterministic");
  });

  it("valid LLM infer → mode 'llm', usedLlm true, grounded, propose-only", async () => {
    const spy = spyInfer(validResult());
    const a = await composeAskAnswer(GROUNDING, "brief me", { panel: "ops" }, { infer: spy.infer });
    assert.equal(spy.calls(), 1);
    assert.equal(a.mode, "llm");
    assert.equal(a.usedLlm, true);
    assert.equal(a.provider, "openai");
    assert.equal(a.proposeOnly, true);
    assert.equal(a.riskLevel, "medium");
    // Summary comes from the LLM...
    assert.equal(a.summary, VALID_OUTPUT.summary);
    // ...but the deterministic facts remain GROUNDED in the answer.
    for (const h of GROUNDING.highlights!) assert.ok(a.highlights.includes(h), `grounded highlight: ${h}`);
    for (const g of GROUNDING.gaps!) assert.ok(a.gaps.includes(g), `grounded gap: ${g}`);
    // The LLM's neededContext is cited as a gap; nextAction surfaces as a PROPOSAL.
    assert.ok(a.gaps.includes("live ops panel"));
    assert.ok(a.highlights.some((h) => /Proposed next action:/.test(h)));
    // No executable/approve instruction leaks into the answer.
    const blob = JSON.stringify(a).toLowerCase();
    assert.ok(!/\bexecute\b|\bapprove\b/.test(blob), "answer must not instruct execute/approve");
  });

  it("infer returns null → honest deterministic fallback", async () => {
    const spy = spyInfer(null);
    const a = await composeAskAnswer(GROUNDING, "brief me", undefined, { infer: spy.infer });
    assert.equal(spy.calls(), 1);
    assert.equal(a.mode, "deterministic");
    assert.equal(a.usedLlm, false);
    assert.equal(a.validation, "fallback");
    assert.equal(a.summary, GROUNDING.summary);
  });

  it("infer throws → honest deterministic fallback", async () => {
    const infer: AskInfer = async () => {
      throw new Error("network boom");
    };
    const a = await composeAskAnswer(GROUNDING, "brief me", undefined, { infer });
    assert.equal(a.mode, "deterministic");
    assert.equal(a.usedLlm, false);
    assert.equal(a.validation, "fallback");
    assert.equal(a.summary, GROUNDING.summary);
  });

  it("invalid LLM output → honest deterministic fallback (never laundered)", async () => {
    // Missing required keys → validateLlmOutput rejects it.
    const bad = validResult({ garbage: true } as unknown as LlmStructuredOutput);
    const spy = spyInfer(bad);
    const a = await composeAskAnswer(GROUNDING, "brief me", undefined, { infer: spy.infer });
    assert.equal(spy.calls(), 1);
    assert.equal(a.mode, "deterministic");
    assert.equal(a.usedLlm, false);
    assert.equal(a.validation, "fallback");
    assert.equal(a.summary, GROUNDING.summary);
  });

  it("redacts a planted secret BEFORE infer sees it, and it never reaches the answer", async () => {
    const secret = "sk-" + "a".repeat(40);
    const spy = spyInfer(validResult());
    const a = await composeAskAnswer(
      GROUNDING,
      `please summarize, my key is ${secret}`,
      { token: `Bearer ${"b".repeat(40)}` },
      { infer: spy.infer }
    );
    // The fake infer must NOT have received the raw secret.
    const seenRequest = spy.lastRequest()!;
    assert.ok(!seenRequest.includes(secret), "raw request-secret must not reach infer");
    assert.ok(seenRequest.includes("[REDACTED]"), "request secret must be redacted");
    // Context secret is deep-redacted too.
    const seenContext = JSON.stringify(spy.lastContext());
    assert.ok(!seenContext.includes("b".repeat(40)), "raw context-secret must not reach infer");
    // The secret never appears anywhere in the produced answer.
    const answerBlob = JSON.stringify(a);
    assert.ok(!answerBlob.includes(secret), "secret must not appear in the answer");
    assert.ok(!answerBlob.includes("b".repeat(40)), "context secret must not appear in the answer");
    // redactedRequest is the scrubbed form.
    assert.ok(a.redactedRequest.includes("[REDACTED]"));
  });

  it("the original request is NEVER forwarded — even on the no-infer path redactedRequest is scrubbed", async () => {
    const secret = "ghp_" + "c".repeat(36);
    const a = await composeAskAnswer(GROUNDING, `secret ${secret}`, undefined, {});
    assert.ok(!a.redactedRequest.includes(secret));
    assert.ok(a.redactedRequest.includes("[REDACTED]"));
  });

  it("is deterministic: same inputs → identical answers", async () => {
    const spy1 = spyInfer(validResult());
    const spy2 = spyInfer(validResult());
    const a = await composeAskAnswer(GROUNDING, "brief me", { p: 1 }, { infer: spy1.infer });
    const b = await composeAskAnswer(GROUNDING, "brief me", { p: 1 }, { infer: spy2.infer });
    assert.deepEqual(a, b);
  });
});
