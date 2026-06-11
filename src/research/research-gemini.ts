/**
 * src/research/research-gemini.ts — Gemini Google-Search GROUNDED research fetcher.
 *
 * The web-gather path on Gemini (the primary LLM) instead of OpenAI's Responses API. Each
 * sub-question is sent to Gemini `generateContent` with the `google_search` grounding tool; the
 * grounded answer + its citation chunks become `GatheredSource[]`. This exists because OpenAI is
 * rate-limited (429) while Gemini is the unthrottled primary — and it keeps research web-grounded
 * with real citations rather than model-memory.
 *
 * Boundaries unchanged: gated by network + GEMINI_API_KEY; a miss/error yields ZERO sources (an
 * honest "unknown" in the dossier — never a fabricated finding). Mirrors buildWebSourceFetcher's
 * SourceFetcher contract so the gatherer/runner treat it identically.
 */

import { resolveLlmConfig, DEFAULT_GEMINI_MODEL } from "../llm/llm-gateway.js";
import type { SourceFetcher } from "./research-gatherer.js";
import type { GatheredSource } from "./research-synthesis.js";
import { redact } from "../llm/redaction.js";

type Env = Record<string, string | undefined>;

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const TRANSIENT = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

const PREAMBLE =
  "You are a rigorous research analyst with Google Search. Research the sub-question and write a " +
  "thorough, specific, source-grounded answer. Prefer primary and reputable sources. If sources " +
  "conflict or are thin, say so. Never invent sources, statistics, or specifics.";

export interface GeminiWebResult {
  content: string;
  model: string;
  citations: { url: string; title: string }[];
}
export type GeminiWebInfer = (subQuestion: string, topic: string) => Promise<GeminiWebResult | null>;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The grounded-research inference fn. Gated; returns null on any miss/error (no fabrication). */
export function buildGeminiResearchInfer(env: Env = process.env): GeminiWebInfer {
  const cfg = resolveLlmConfig(env);
  const model = env["HARTOS_RESEARCH_GEMINI_MODEL"]?.trim() || "gemini-2.5-flash";
  const apiKey = (env["GEMINI_API_KEY"] ?? "").trim();
  return async (subQuestion, topic) => {
    if (!cfg.networkEnabled || !cfg.geminiKeyPresent || !apiKey) return null;
    const body = {
      systemInstruction: { parts: [{ text: PREAMBLE }] },
      contents: [{ role: "user", parts: [{ text: redact(`Topic: ${topic}\nResearch sub-question: ${subQuestion}`) }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0 },
    };
    const url = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`;
    let res: Response | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(body),
        });
      } catch {
        if (attempt < MAX_ATTEMPTS) { await sleep(300 * attempt); continue; }
        return null;
      }
      if (res.ok) break;
      if (TRANSIENT.has(res.status) && attempt < MAX_ATTEMPTS) { await sleep(300 * attempt); continue; }
      console.error(`[research-gemini] grounding returned ${res.status} for model "${model}".`);
      return null;
    }
    if (!res || !res.ok) return null;

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      return null;
    }
    const cand = (payload as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: unknown }> };
        groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: unknown; title?: unknown } }> };
      }>;
    })?.candidates?.[0];
    const content = (cand?.content?.parts ?? [])
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .join("")
      .trim();
    if (!content) return null;
    const citations: { url: string; title: string }[] = [];
    for (const c of cand?.groundingMetadata?.groundingChunks ?? []) {
      const uri = typeof c.web?.uri === "string" ? c.web.uri : "";
      const title = typeof c.web?.title === "string" ? c.web.title : "";
      if (uri) citations.push({ url: uri, title: title || uri });
    }
    return { content, model, citations };
  };
}

export interface BuildGeminiFetcherOptions {
  topic: string;
  now: string;
  env?: Env;
  infer?: GeminiWebInfer;
}

/** A SourceFetcher backed by Gemini grounding — drop-in for buildWebSourceFetcher. */
export function buildGeminiSourceFetcher(opts: BuildGeminiFetcherOptions): SourceFetcher {
  const infer = opts.infer ?? buildGeminiResearchInfer(opts.env);
  return async (subQuestion, index) => {
    const r = await infer(subQuestion, opts.topic);
    if (!r) return [];
    if (r.citations.length === 0) {
      return [
        {
          ref: `gemini:${r.model}:uncited`,
          title: `Gemini grounded answer (${r.model}, no citation chunks returned)`,
          content: r.content,
          answers: [index],
          asOf: opts.now,
        },
      ];
    }
    return r.citations.map((c): GatheredSource => ({
      ref: c.url,
      title: c.title,
      content: r.content,
      answers: [index],
      asOf: opts.now,
    }));
  };
}
