/**
 * tests/research-claude.test.ts — headless-Claude research fetcher (pure parts; runner injected).
 * JSON/fence parsing, source mapping, gate (no token ⇒ null ⇒ zero sources, never fabricated).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseClaudeResearch,
  buildClaudeResearchInfer,
  buildClaudeSourceFetcher,
  type ClaudeRunner,
} from "../src/research/research-claude.js";

const NOW = "2026-06-12T00:00:00.000Z";

describe("parseClaudeResearch", () => {
  it("parses a clean JSON object", () => {
    const r = parseClaudeResearch('{"answer":"X","sources":[{"title":"T","url":"https://a.com"}]}');
    assert.equal(r?.answer, "X");
    assert.equal(r?.sources.length, 1);
    assert.equal(r?.sources[0]!.url, "https://a.com");
  });
  it("strips ```json fences", () => {
    const r = parseClaudeResearch('```json\n{"answer":"Y","sources":[]}\n```');
    assert.equal(r?.answer, "Y");
    assert.deepEqual(r?.sources, []);
  });
  it("drops sources missing a url; backfills title from url", () => {
    const r = parseClaudeResearch('{"answer":"Z","sources":[{"title":"no-url"},{"url":"https://b.com"}]}');
    assert.equal(r?.sources.length, 1);
    assert.equal(r?.sources[0]!.title, "https://b.com");
  });
  it("returns null on non-JSON or empty answer", () => {
    assert.equal(parseClaudeResearch("not json"), null);
    assert.equal(parseClaudeResearch('{"sources":[]}'), null);
  });
});

describe("buildClaudeResearchInfer gate", () => {
  it("returns null with NO token (never spawns)", async () => {
    let ran = false;
    const runner: ClaudeRunner = async () => { ran = true; return '{"answer":"x","sources":[]}'; };
    const infer = buildClaudeResearchInfer({}, runner);
    assert.equal(await infer("q", "t"), null);
    assert.equal(ran, false, "must not spawn claude without a token");
  });
  it("runs with a token and returns the parsed result", async () => {
    const runner: ClaudeRunner = async () => '{"answer":"grounded","sources":[{"title":"T","url":"https://x.com"}]}';
    const infer = buildClaudeResearchInfer({ CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-test" }, runner);
    const r = await infer("q", "t");
    assert.equal(r?.answer, "grounded");
    assert.equal(r?.sources[0]!.url, "https://x.com");
  });
});

describe("buildClaudeSourceFetcher", () => {
  const tokenEnv = { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-test" };
  it("maps grounded sources to GatheredSource[] (ref=url, content=answer, answers=[index])", async () => {
    const runner: ClaudeRunner = async () =>
      '{"answer":"the answer","sources":[{"title":"FitBudd","url":"https://fitbudd.com"},{"title":"1Fit","url":"https://1fit.com"}]}';
    const fetcher = buildClaudeSourceFetcher({ topic: "t", now: NOW, env: tokenEnv, infer: buildClaudeResearchInfer(tokenEnv, runner) });
    const sources = await fetcher("q", 2);
    assert.equal(sources.length, 2);
    assert.equal(sources[0]!.ref, "https://fitbudd.com");
    assert.deepEqual(sources[0]!.answers, [2]);
    assert.match(sources[1]!.content, /the answer/);
  });
  it("answer with no sources ⇒ one honest 'uncited' source", async () => {
    const runner: ClaudeRunner = async () => '{"answer":"found nothing concrete","sources":[]}';
    const sources = await buildClaudeSourceFetcher({ topic: "t", now: NOW, env: tokenEnv, infer: buildClaudeResearchInfer(tokenEnv, runner) })("q", 0);
    assert.equal(sources.length, 1);
    assert.match(sources[0]!.ref, /^claude:max:uncited$/);
  });
  it("infer null (no token / error) ⇒ ZERO sources — never fabricated", async () => {
    const sources = await buildClaudeSourceFetcher({ topic: "t", now: NOW, env: {}, infer: buildClaudeResearchInfer({}, async () => null) })("q", 1);
    assert.deepEqual(sources, []);
  });
});
