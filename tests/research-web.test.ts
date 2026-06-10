/**
 * tests/research-web.test.ts — web-search gathering: the pure payload parser + fetcher mapping.
 * No network: the OpenAI Responses payload is a fixture; the fetcher uses an injected infer.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseResponsesPayload, buildWebSourceFetcher, type WebInfer } from "../src/research/research-web.js";

const NOW = "2026-06-10T12:00:00Z";

describe("parseResponsesPayload", () => {
  it("extracts answer text + de-duped url citations from a Responses payload", () => {
    const payload = {
      output: [
        { type: "web_search_call" },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "Defense and energy are the largest sectors.",
              annotations: [
                { type: "url_citation", url: "https://a.com", title: "A" },
                { type: "url_citation", url: "https://b.com", title: "B" },
                { type: "url_citation", url: "https://a.com", title: "A again" },
              ],
            },
          ],
        },
      ],
    };
    const r = parseResponsesPayload(payload, "gpt-5.5")!;
    assert.equal(r.content, "Defense and energy are the largest sectors.");
    assert.equal(r.model, "gpt-5.5");
    assert.deepEqual(r.citations.map((c) => c.url), ["https://a.com", "https://b.com"]); // deduped
  });

  it("falls back to top-level output_text and returns null on empty", () => {
    assert.equal(parseResponsesPayload({ output_text: "Top-level answer." }, "m")!.content, "Top-level answer.");
    assert.equal(parseResponsesPayload({ output: [] }, "m"), null);
    assert.equal(parseResponsesPayload({ output: [{ type: "message", content: [{ type: "output_text", text: "   " }] }] }, "m"), null);
  });
});

describe("buildWebSourceFetcher (injected infer, no network)", () => {
  it("maps each cited URL to its own source (corroboration)", async () => {
    const infer: WebInfer = async () => ({
      content: "Grounded answer.",
      citations: [{ url: "https://u1", title: "T1" }, { url: "https://u2", title: "T2" }],
      model: "gpt-5.5",
    });
    const fetcher = buildWebSourceFetcher({ topic: "t", now: NOW, infer });
    const s = await fetcher("sub-q", 3);
    assert.equal(s.length, 2);
    assert.deepEqual(s.map((x) => x.ref), ["https://u1", "https://u2"]);
    assert.ok(s.every((x) => x.answers?.[0] === 3 && x.content === "Grounded answer."));
  });

  it("an answer with no citations is one honestly-labelled uncited source", async () => {
    const infer: WebInfer = async () => ({ content: "Answer without citations.", citations: [], model: "gpt-5.5" });
    const s = await buildWebSourceFetcher({ topic: "t", now: NOW, infer })("q", 0);
    assert.equal(s.length, 1);
    assert.match(s[0].ref, /uncited/);
  });

  it("a null infer yields no source — honest unknown", async () => {
    assert.deepEqual(await buildWebSourceFetcher({ topic: "t", now: NOW, infer: async () => null })("q", 0), []);
  });
});
