/**
 * src/research/research-web.ts — NODE host: WEB-SEARCH research gathering (real cited sources).
 *
 * The LLM fetcher (research-llm.ts) answers from model knowledge → a single source, medium
 * confidence. This fetcher uses OpenAI's web_search tool (Responses API) so each answer is grounded
 * in real, citable URLs. Each distinct cited URL becomes its own GatheredSource, so corroboration
 * lifts a finding to HIGH confidence — a genuine upgrade over model-knowledge.
 *
 * Same triple gate (provider=openai + network + key) + the HARTOS_RESEARCH_GATHER arm flag upstream.
 * Honesty floor preserved: returns null (→ honest unknown) unless a real call returned content;
 * an answer with NO citations is labelled an uncited model-knowledge web answer (stays medium at
 * best), never dressed up as sourced. The request is redacted; the key is never logged.
 *
 * The payload PARSER is pure + unit-tested; only the network call is untested (it fails safe).
 */

import { resolveLlmConfig } from "../llm/llm-gateway.js";
import { redact } from "../llm/redaction.js";
import type { SourceFetcher } from "./research-gatherer.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
type Env = Record<string, string | undefined>;

export interface WebCitation {
  url: string;
  title: string;
}
export interface WebAnswer {
  content: string;
  citations: WebCitation[];
  model: string;
}

/**
 * PURE: parse an OpenAI Responses API payload into answer text + de-duped URL citations. Defensive
 * against shape drift (optional chaining, arrays maybe absent). Returns null when there is no text.
 */
export function parseResponsesPayload(payload: unknown, model: string): WebAnswer | null {
  const p = payload as {
    output?: Array<{ type?: string; content?: Array<{ text?: unknown; annotations?: Array<{ type?: string; url?: unknown; title?: unknown }> }> }>;
    output_text?: unknown;
  };
  const texts: string[] = [];
  const citations: WebCitation[] = [];

  for (const item of Array.isArray(p?.output) ? p.output : []) {
    if (item?.type !== "message") continue;
    for (const c of Array.isArray(item.content) ? item.content : []) {
      if (typeof c?.text === "string" && c.text.trim()) texts.push(c.text.trim());
      for (const a of Array.isArray(c?.annotations) ? c.annotations : []) {
        if (typeof a?.url === "string" && a.url.trim()) {
          citations.push({ url: a.url, title: typeof a.title === "string" && a.title.trim() ? a.title : a.url });
        }
      }
    }
  }
  if (texts.length === 0 && typeof p?.output_text === "string" && p.output_text.trim()) texts.push(p.output_text.trim());

  const content = texts.join("\n\n").trim();
  if (!content) return null;

  const seen = new Set<string>();
  const uniq: WebCitation[] = [];
  for (const c of citations) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    uniq.push(c);
  }
  return { content, citations: uniq, model };
}

export type WebInfer = (subQuestion: string, topic: string) => Promise<WebAnswer | null>;

const WEB_RESEARCH_PREAMBLE =
  "You are a rigorous research analyst with web search. Research the sub-question using web search and write a thorough, specific, source-grounded answer. Prefer primary and reputable sources; cite them. If sources conflict or are thin, say so. Never invent sources, statistics, or specifics.";

/** A web-search inference fn (Responses API + web_search tool). Gated; null on any miss/error. */
export function buildWebResearchInfer(env: Env = process.env): WebInfer {
  const cfg = resolveLlmConfig(env);
  // Web search is an OpenAI Responses-API feature, so it runs on the OpenAI key + model regardless
  // of which provider is PRIMARY for general reasoning (Gemini primary ⇒ OpenAI still powers research).
  const model = env["HARTOS_RESEARCH_WEB_MODEL"]?.trim() || cfg.openaiModel || cfg.model;
  return async (subQuestion, topic) => {
    if (!cfg.networkEnabled || !cfg.openaiKeyPresent) return null;
    const apiKey = (env["OPENAI_API_KEY"] ?? "").trim();
    if (!apiKey) return null;

    const body = {
      model,
      tools: [{ type: "web_search" }],
      input: redact(`${WEB_RESEARCH_PREAMBLE}\n\nTopic: ${topic}\nResearch sub-question: ${subQuestion}`),
    };
    try {
      const res = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // Surface the status (never the key/body) so a misconfigured model/tool is diagnosable.
        console.warn(`[research-web] responses API returned ${res.status} for model "${model}".`);
        return null;
      }
      return parseResponsesPayload(await res.json(), model);
    } catch (e) {
      console.warn(`[research-web] request failed: ${e instanceof Error ? e.message : "error"}`);
      return null;
    }
  };
}

export interface BuildWebFetcherOptions {
  topic: string;
  now: string;
  env?: Env;
  /** Inject a fake infer in tests so no real network occurs. */
  infer?: WebInfer;
}

/**
 * A SourceFetcher backed by web search. Each distinct cited URL becomes its own source (real ref →
 * corroboration → HIGH confidence in synthesis). An answer with no citations is one honestly-
 * labelled uncited source (stays medium); a null infer yields [] (honest unknown).
 */
export function buildWebSourceFetcher(opts: BuildWebFetcherOptions): SourceFetcher {
  const infer = opts.infer ?? buildWebResearchInfer(opts.env);
  return async (subQuestion, index) => {
    const r = await infer(subQuestion, opts.topic);
    if (!r) return [];
    if (r.citations.length === 0) {
      return [
        {
          ref: `web:${r.model}:uncited`,
          title: `Web answer (${r.model}, no citations returned)`,
          content: r.content,
          answers: [index],
          asOf: opts.now,
        },
      ];
    }
    return r.citations.map((c) => ({ ref: c.url, title: c.title, content: r.content, answers: [index], asOf: opts.now }));
  };
}
