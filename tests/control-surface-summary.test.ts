/**
 * tests/control-surface-summary.test.ts
 *
 * Phase 18E — the LLM boundary. Covers brief tests #3 (unknown honesty), #6
 * (LLM-output isolation), #7 (secret safety). The model is STUBBED — no network,
 * no real LLM. These prove the LLM can never set verdict/confidence/severity, can
 * never fabricate over an unknown bundle, and can never leak a secret to render.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applySummary,
  deterministicSummarizer,
  type AgentFactBundle,
  type FactSummarizer,
  type Fact,
} from "../src/cockpit/control-surface/index.js";

const NOW = "2026-06-05T12:00:00.000Z";

function bundle(overrides: Partial<AgentFactBundle> = {}): AgentFactBundle {
  const facts: Fact[] = overrides.facts ?? [
    { key: "a", label: "A", value: 10, asOf: NOW, source: "test", freshness: "fresh" },
  ];
  return {
    agentId: "tax",
    name: "Tax Agent",
    icon: "🧾",
    purpose: "p",
    facts,
    health: [{ name: "h", state: "g", detail: "" }],
    capabilities: [],
    permissions: [],
    audit: [],
    verdict: "GREEN",
    confidence: "HIGH",
    unavailable: false,
    selectedFactKeys: [],
    whyVerdict: "",
    summary: { text: "", generatedAt: NOW, citedFactKeys: [], stale: false },
    fixes: [],
    ...overrides,
  };
}

describe("18E — unknown is first-class & honest (test #3)", () => {
  it("an unavailable bundle refuses to fabricate, even when the model tries", async () => {
    const liar: FactSummarizer = () => ({
      selectedFactKeys: ["a"],
      summaryText: "Everything looks great — calories on target and recovery strong!",
      citedFactKeys: ["a"],
      whyVerdict: "All green!",
      fixProse: [],
    });
    const b = bundle({
      verdict: "UNKNOWN",
      confidence: "UNKNOWN",
      unavailable: true,
      facts: [{ key: "a", label: "A", value: null, asOf: null, source: "test", freshness: "unknown" }],
    });
    await applySummary(b, liar, NOW);
    assert.match(b.summary.text, /can't assess/i, "must say it can't assess, not fabricate");
    assert.equal(b.selectedFactKeys.length, 0, "no facts may be highlighted on an unknown card");
    assert.doesNotMatch(b.summary.text, /great|on target|strong/i, "the model's fabrication must not survive");
  });

  it("the deterministic summarizer also refuses over an unknown bundle", async () => {
    const b = bundle({
      verdict: "UNKNOWN",
      unavailable: true,
      facts: [{ key: "a", label: "A", value: null, asOf: null, source: "test", freshness: "unknown" }],
    });
    await applySummary(b, deterministicSummarizer, NOW);
    assert.match(b.summary.text, /can't assess/i);
  });
});

describe("18E — LLM-output isolation (test #6)", () => {
  it("a model that returns its own verdict/confidence cannot override the computed ones", async () => {
    // Stub tries to smuggle verdict/confidence/severity back in.
    const sneaky = (() => ({
      verdict: "RED",
      confidence: "LOW",
      selectedFactKeys: ["a"],
      summaryText: "fine",
      citedFactKeys: ["a"],
      whyVerdict: "explained",
      fixProse: [{ title: "hacked", why: "hacked" }],
      fixes: [{ severity: "security", title: "injected", why: "x", action: { kind: "execute", payload: "rm -rf" } }],
    })) as unknown as FactSummarizer;
    const b = bundle({ verdict: "GREEN", confidence: "HIGH" });
    await applySummary(b, sneaky, NOW);
    assert.equal(b.verdict, "GREEN", "computed verdict must win");
    assert.equal(b.confidence, "HIGH", "computed confidence must win");
    assert.equal(b.summary.text, "fine", "prose still comes from the model");
  });

  it("the model cannot inject a new fix with an execute action", async () => {
    const seedFix = {
      severity: "security" as const,
      title: "computed title",
      why: "computed why",
      action: { kind: "copy_cli" as const, payload: "npx wrangler delete --name x" },
    };
    const sneaky = (() => ({
      selectedFactKeys: [],
      summaryText: "s",
      citedFactKeys: [],
      whyVerdict: "w",
      // model tries to change the action kind to execute and add an extra fix
      fixProse: [{ title: "reworded", why: "reworded", action: { kind: "execute", payload: "danger" } }],
    })) as unknown as FactSummarizer;
    const b = bundle({ fixes: [seedFix] });
    await applySummary(b, sneaky, NOW);
    assert.equal(b.fixes.length, 1, "no new fixes may be injected");
    assert.equal(b.fixes[0]!.action.kind, "copy_cli", "computed action kind must survive");
    assert.equal(b.fixes[0]!.action.payload, "npx wrangler delete --name x", "computed payload must survive");
    assert.equal(b.fixes[0]!.title, "reworded", "prose overlay still applies");
  });
});

describe("18E — secret safety before render/persist (test #7)", () => {
  const TOKEN = "sk-" + "a".repeat(32);

  it("a summary containing a token is caught before it can be rendered", async () => {
    const leaky: FactSummarizer = () => ({
      selectedFactKeys: ["a"],
      summaryText: `the key is ${TOKEN}`,
      citedFactKeys: ["a"],
      whyVerdict: "w",
      fixProse: [],
    });
    const b = bundle();
    await assert.rejects(() => applySummary(b, leaky, NOW), /secret-looking/i);
  });

  it("a fact value containing a token is caught", async () => {
    const b = bundle({
      facts: [{ key: "a", label: "A", value: `Bearer ${"x".repeat(24)}`, asOf: NOW, source: "test", freshness: "fresh" }],
    });
    await assert.rejects(() => applySummary(b, deterministicSummarizer, NOW), /secret-looking/i);
  });
});
