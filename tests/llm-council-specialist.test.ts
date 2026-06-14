/**
 * tests/llm-council-specialist.test.ts
 *
 * Focused tests for the council specialist path (P7 Seam 1):
 *   1. validateCouncilSpecialistOutput — valid + each malformed shape
 *   2. LlmGateway.runCouncilSpecialist — deterministic→output:null, real provider→output
 *   3. councilInferFromEnv — forwards real model risks, low stub when off
 *
 * No network. Providers are injected/faked.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateCouncilSpecialistOutput } from "../src/llm/output-validator.js";
import { LlmGateway } from "../src/llm/llm-gateway.js";
import type { LlmProvider } from "../src/llm/llm-types.js";
import { councilInferFromEnv } from "../src/council/council-specialists.js";

// ---------------------------------------------------------------------------
// 1. validateCouncilSpecialistOutput
// ---------------------------------------------------------------------------

describe("validateCouncilSpecialistOutput", () => {
  const VALID_COUNCIL = {
    summary: "The specialist finds strong technical feasibility.",
    confidence: "high" as const,
    risks: ["integration complexity", "timeline risk"],
  };

  it("accepts a well-formed council output", () => {
    const v = validateCouncilSpecialistOutput(VALID_COUNCIL);
    assert.equal(v.ok, true);
    assert.equal(v.value?.confidence, "high");
    assert.deepEqual(v.value?.risks, ["integration complexity", "timeline risk"]);
  });

  it("accepts risks:[] (empty array is valid)", () => {
    const v = validateCouncilSpecialistOutput({ ...VALID_COUNCIL, risks: [] });
    assert.equal(v.ok, true);
    assert.deepEqual(v.value?.risks, []);
  });

  it("rejects non-objects", () => {
    assert.equal(validateCouncilSpecialistOutput("nope").ok, false);
    assert.equal(validateCouncilSpecialistOutput(null).ok, false);
    assert.equal(validateCouncilSpecialistOutput([1, 2]).ok, false);
    assert.equal(validateCouncilSpecialistOutput(42).ok, false);
  });

  it("rejects missing summary", () => {
    const { summary: _, ...rest } = VALID_COUNCIL;
    void _;
    assert.equal(validateCouncilSpecialistOutput(rest).ok, false);
  });

  it("rejects missing confidence", () => {
    const { confidence: _, ...rest } = VALID_COUNCIL;
    void _;
    assert.equal(validateCouncilSpecialistOutput(rest).ok, false);
  });

  it("rejects missing risks", () => {
    const { risks: _, ...rest } = VALID_COUNCIL;
    void _;
    assert.equal(validateCouncilSpecialistOutput(rest).ok, false);
  });

  it("rejects empty summary", () => {
    assert.equal(validateCouncilSpecialistOutput({ ...VALID_COUNCIL, summary: "" }).ok, false);
  });

  it("rejects summary that is not a string", () => {
    assert.equal(validateCouncilSpecialistOutput({ ...VALID_COUNCIL, summary: 42 }).ok, false);
  });

  it("rejects invalid confidence values", () => {
    assert.equal(validateCouncilSpecialistOutput({ ...VALID_COUNCIL, confidence: "certain" }).ok, false);
    assert.equal(validateCouncilSpecialistOutput({ ...VALID_COUNCIL, confidence: "HIGH" }).ok, false);
    assert.equal(validateCouncilSpecialistOutput({ ...VALID_COUNCIL, confidence: "" }).ok, false);
  });

  it("accepts all three valid confidence values", () => {
    for (const confidence of ["low", "medium", "high"] as const) {
      assert.equal(validateCouncilSpecialistOutput({ ...VALID_COUNCIL, confidence }).ok, true);
    }
  });

  it("rejects risks that is not an array", () => {
    assert.equal(validateCouncilSpecialistOutput({ ...VALID_COUNCIL, risks: "nope" }).ok, false);
    assert.equal(validateCouncilSpecialistOutput({ ...VALID_COUNCIL, risks: { x: 1 } }).ok, false);
  });

  it("rejects oversized risks array", () => {
    assert.equal(validateCouncilSpecialistOutput({ ...VALID_COUNCIL, risks: Array(50).fill("risk") }).ok, false);
  });

  it("rejects token-like strings in summary", () => {
    const leaked = "summary sk-" + "a".repeat(28);
    assert.equal(validateCouncilSpecialistOutput({ ...VALID_COUNCIL, summary: leaked }).ok, false);
  });

  it("rejects token-like strings in risks items", () => {
    const leaked = "sk-" + "a".repeat(28);
    assert.equal(validateCouncilSpecialistOutput({ ...VALID_COUNCIL, risks: [leaked] }).ok, false);
  });

  it("allows a longer summary (MAX_SUMMARY_LENGTH ceiling), still bounded", () => {
    assert.equal(validateCouncilSpecialistOutput({ ...VALID_COUNCIL, summary: "x".repeat(1500) }).ok, true);
    assert.equal(validateCouncilSpecialistOutput({ ...VALID_COUNCIL, summary: "x".repeat(5000) }).ok, false);
  });
});

// ---------------------------------------------------------------------------
// 2. LlmGateway.runCouncilSpecialist
// ---------------------------------------------------------------------------

function makeCouncilProvider(impl: () => unknown): LlmProvider {
  return {
    name: "openai",
    async generate() { return impl(); },
  };
}

const VALID_COUNCIL_RAW = {
  summary: "The specialist finds strong technical feasibility.",
  confidence: "high",
  risks: ["integration complexity"],
};

describe("LlmGateway.runCouncilSpecialist", () => {
  it("deterministic mode → output:null, ok:true, mode:'deterministic'", async () => {
    const gw = new LlmGateway({ env: {} });
    const result = await gw.runCouncilSpecialist("System: be a CTO\n\nUser: evaluate this plan");
    assert.equal(result.ok, true);
    assert.equal(result.mode, "deterministic");
    assert.equal(result.output, null, "deterministic path must return output:null");
  });

  it("network gate off → output:null even when provider key present", async () => {
    // Key present but HARTOS_LLM_ENABLE_NETWORK not set → deterministic.
    const spy = makeCouncilProvider(() => VALID_COUNCIL_RAW);
    const gw = new LlmGateway({
      env: { HARTOS_LLM_PROVIDER: "openai", OPENAI_API_KEY: "test-key" },
      providers: { openai: spy },
    });
    const result = await gw.runCouncilSpecialist("test");
    assert.equal(result.ok, true);
    assert.equal(result.output, null, "network off → output:null");
  });

  it("real provider + valid council output → ok:true, output with real risks", async () => {
    const provider = makeCouncilProvider(() => VALID_COUNCIL_RAW);
    const gw = new LlmGateway({
      env: { HARTOS_LLM_PROVIDER: "openai", HARTOS_LLM_ENABLE_NETWORK: "true", OPENAI_API_KEY: "test-key" },
      providers: { openai: provider },
    });
    const result = await gw.runCouncilSpecialist("System: be a CTO\n\nUser: evaluate plan");
    assert.equal(result.ok, true);
    assert.equal(result.mode, "openai");
    assert.ok(result.output !== null, "real provider must return non-null output");
    assert.equal(result.output!.confidence, "high");
    assert.deepEqual(result.output!.risks, ["integration complexity"]);
    assert.equal(result.output!.summary, "The specialist finds strong technical feasibility.");
  });

  it("real provider returns malformed council output → output:null (fallback)", async () => {
    // Provider returns an 8-field shape — NOT a valid council output (missing risks etc.).
    const provider = makeCouncilProvider(() => ({ garbage: true }));
    const gw = new LlmGateway({
      env: { HARTOS_LLM_PROVIDER: "openai", HARTOS_LLM_ENABLE_NETWORK: "true", OPENAI_API_KEY: "test-key" },
      providers: { openai: provider },
    });
    const result = await gw.runCouncilSpecialist("test");
    assert.equal(result.ok, true);
    assert.equal(result.output, null, "malformed council output → fallback → output:null");
    assert.equal(result.mode, "fallback");
  });

  it("real provider throws → output:null (fallback), never throws", async () => {
    const provider = makeCouncilProvider(() => { throw new Error("network kaboom"); });
    const gw = new LlmGateway({
      env: { HARTOS_LLM_PROVIDER: "openai", HARTOS_LLM_ENABLE_NETWORK: "true", OPENAI_API_KEY: "test-key" },
      providers: { openai: provider },
    });
    let threw = false;
    let result;
    try {
      result = await gw.runCouncilSpecialist("test");
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "runCouncilSpecialist must never throw");
    assert.equal(result?.ok, true);
    assert.equal(result?.output, null);
  });

  it("does NOT use the 8-field LlmStructuredOutput — council output has risks[] not riskLevel", async () => {
    const provider = makeCouncilProvider(() => ({
      summary: "technical feasibility confirmed",
      confidence: "medium",
      risks: ["budget overrun", "scope creep"],
    }));
    const gw = new LlmGateway({
      env: { HARTOS_LLM_PROVIDER: "openai", HARTOS_LLM_ENABLE_NETWORK: "true", OPENAI_API_KEY: "test-key" },
      providers: { openai: provider },
    });
    const result = await gw.runCouncilSpecialist("test");
    assert.ok(result.output !== null);
    // Council output has risks (string[]) not riskLevel
    assert.ok(Array.isArray(result.output!.risks));
    assert.ok(!("riskLevel" in result.output!), "council output must NOT have riskLevel");
    assert.ok(!("intent" in result.output!), "council output must NOT have the 8-field intent key");
  });
});

// ---------------------------------------------------------------------------
// 3. councilInferFromEnv — model risks forwarded; low stub when gate off
// ---------------------------------------------------------------------------

describe("councilInferFromEnv (P7 seam1 rewire)", () => {
  it("gate off → honest LOW stub, risks mention unavailability", async () => {
    const infer = councilInferFromEnv({});
    const raw = await infer({ system: "be a CTO", user: "evaluate this" });
    const parsed = JSON.parse(raw) as { confidence: string; summary: string; risks: string[] };
    assert.equal(parsed.confidence, "low", "gate-off must produce low confidence");
    assert.match(parsed.summary, /unavailable|stub|degraded/i, "stub summary must admit LLM unavailable");
  });

  it("real provider with real risks → risks forwarded in returned JSON", async () => {
    // Inject a provider that returns a valid council output with real risks.
    const provider = makeCouncilProvider(() => ({
      summary: "The CTO lens shows strong feasibility with two risks.",
      confidence: "high",
      risks: ["vendor lock-in", "integration debt"],
    }));
    // Build gateway manually and inject: we can't inject providers through councilInferFromEnv directly,
    // so we test the gateway→council flow by constructing gateway with fake provider + calling runCouncilSpecialist.
    const gw = new LlmGateway({
      env: { HARTOS_LLM_PROVIDER: "openai", HARTOS_LLM_ENABLE_NETWORK: "true", OPENAI_API_KEY: "test-key" },
      providers: { openai: provider },
    });
    const result = await gw.runCouncilSpecialist("System: be a CTO\n\nUser: evaluate plan");
    // Simulate what councilInferFromEnv does when it gets a real result.
    const realLlm = result.ok && result.mode !== "deterministic" && result.mode !== "fallback";
    assert.equal(realLlm, true, "should be a real LLM path");
    assert.ok(result.output !== null);
    // The output would be returned as JSON.stringify(result.output) by councilInferFromEnv.
    const forwarded = JSON.stringify(result.output);
    const parsed = JSON.parse(forwarded) as { summary: string; confidence: string; risks: string[] };
    assert.deepEqual(parsed.risks, ["vendor lock-in", "integration debt"], "real risks must be forwarded");
    assert.equal(parsed.confidence, "high");
  });

  it("never throws regardless of env", async () => {
    for (const env of [
      {},
      { HARTOS_LLM_PROVIDER: "deterministic" },
      { HARTOS_LLM_PROVIDER: "openai" /* no key */ },
    ]) {
      const infer = councilInferFromEnv(env);
      let threw = false;
      try {
        await infer({ system: "s", user: "u" });
      } catch {
        threw = true;
      }
      assert.equal(threw, false, `councilInferFromEnv must never throw for env ${JSON.stringify(env)}`);
    }
  });

  it("gate off paths all return parseable JSON with confidence:'low'", async () => {
    for (const env of [
      {},
      { HARTOS_LLM_PROVIDER: "deterministic" },
      { HARTOS_LLM_PROVIDER: "gemini" /* no key → fallback */ },
    ]) {
      const raw = await councilInferFromEnv(env)({ system: "s", user: "u" });
      const parsed = JSON.parse(raw) as { confidence: string };
      assert.equal(parsed.confidence, "low",
        `LLM-off must report low confidence, got ${parsed.confidence} for env ${JSON.stringify(env)}`);
    }
  });
});
