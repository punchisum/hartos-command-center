/**
 * tests/research-gemini.test.ts — the Gemini-grounded research fetcher (pure mapping).
 * Citations → GatheredSource[]; null/empty handling; never fabricates. Infer is injected (no network).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildGeminiSourceFetcher, type GeminiWebInfer } from "../src/research/research-gemini.js";

const NOW = "2026-06-11T00:00:00.000Z";

describe("buildGeminiSourceFetcher", () => {
  it("maps grounded citations to one GatheredSource each (ref=url, content carried, answers=[index])", async () => {
    const infer: GeminiWebInfer = async () => ({
      content: "Trainerize and Gymkee are leading options.",
      model: "gemini-2.5-flash",
      citations: [
        { url: "https://gymkee.com", title: "gymkee.com" },
        { url: "https://trainerize.com", title: "Trainerize" },
      ],
    });
    const fetcher = buildGeminiSourceFetcher({ topic: "coaching apps", now: NOW, infer });
    const sources = await fetcher("which apps?", 1);
    assert.equal(sources.length, 2);
    assert.equal(sources[0]!.ref, "https://gymkee.com");
    assert.equal(sources[0]!.title, "gymkee.com");
    assert.deepEqual(sources[0]!.answers, [1]);
    assert.equal(sources[0]!.asOf, NOW);
    assert.match(sources[1]!.content, /Trainerize/);
  });

  it("a grounded answer with NO citations yields one honest 'uncited' source (not dropped)", async () => {
    const infer: GeminiWebInfer = async () => ({ content: "An answer with no chunks.", model: "gemini-2.5-flash", citations: [] });
    const sources = await buildGeminiSourceFetcher({ topic: "t", now: NOW, infer })("q", 0);
    assert.equal(sources.length, 1);
    assert.match(sources[0]!.ref, /^gemini:.*:uncited$/);
    assert.match(sources[0]!.title, /no citation chunks/i);
  });

  it("infer null (gate off / 429 / error) ⇒ ZERO sources — never a fabricated finding", async () => {
    const infer: GeminiWebInfer = async () => null;
    const sources = await buildGeminiSourceFetcher({ topic: "t", now: NOW, infer })("q", 2);
    assert.deepEqual(sources, []);
  });
});
