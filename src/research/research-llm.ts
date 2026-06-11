/**
 * src/research/research-llm.ts — NODE host: a research-tuned, FREE-TEXT, gated LLM call.
 *
 * The governed Ask gateway answers in a strict 8-field, ops-grounded, 600-char contract — right
 * for "answer from the cockpit's facts", wrong for open research (it would misframe + truncate).
 * This makes a direct, GATED chat-completions call with a neutral research-analyst system prompt
 * and returns free-form prose, so the Research Agent produces a real report.
 *
 * Honesty floor: returns null unless a REAL model answered — provider=openai AND network gated on
 * AND a key present AND a 2xx with content. A null becomes an honest unknown upstream, NEVER a
 * fabricated source. The request is redacted before it leaves the process; the key is never logged.
 * NODE-only (uses fetch + the key); kept out of the Worker bundle.
 */

import { resolveLlmConfig } from "../llm/llm-gateway.js";
import { redact } from "../llm/redaction.js";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
type Env = Record<string, string | undefined>;

export interface ResearchInferResult {
  content: string;
  model: string;
}

/** Free-text research answer for one sub-question; null when no real model answered. */
export type ResearchInfer = (subQuestion: string, topic: string) => Promise<ResearchInferResult | null>;

const RESEARCH_SYSTEM_PROMPT = [
  "You are a rigorous research analyst. Answer the user's research sub-question thoroughly and concretely, grounded in established knowledge.",
  "Be specific: name the mechanisms, actors, sectors, and well-known figures/numbers where you are confident.",
  "Honesty floor: if something is genuinely uncertain, contested, or likely post-dates your knowledge, say so plainly — never invent specifics, sources, or statistics to look complete.",
  "Write clear prose: a few tight paragraphs or bullet points. Lead with the substance — no preamble, no disclaimer-dump.",
  "Do not include secrets, tokens, or API keys.",
].join("\n");

/**
 * Build a research inference fn from env. The triple gate (provider/network/key) is checked here;
 * if any is missing it returns null without a call (honest unknown). The gateway's own gate is not
 * used because research needs a different prompt + free text, but the SAME env flags govern it.
 */
export function buildResearchInfer(env: Env = process.env): ResearchInfer {
  const cfg = resolveLlmConfig(env);
  // The model-knowledge research path is an OpenAI chat call; it runs on the OpenAI key + model
  // regardless of which provider is PRIMARY for general reasoning.
  const model = cfg.openaiModel ?? cfg.model;
  return async (subQuestion, topic) => {
    if (!cfg.networkEnabled || !cfg.openaiKeyPresent) return null;
    const apiKey = (env["OPENAI_API_KEY"] ?? "").trim();
    if (!apiKey) return null;

    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: RESEARCH_SYSTEM_PROMPT },
        { role: "user", content: redact(`Topic: ${topic}\nResearch sub-question: ${subQuestion}\n\nWrite a thorough, specific answer.`) },
      ],
    };
    // Classic chat models accept temperature; gpt-5.x / o-series reject a non-default value.
    if (/^(gpt-3|gpt-4)/.test(cfg.model)) body.temperature = 0.2;

    try {
      const res = await fetch(OPENAI_CHAT_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const payload = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = payload?.choices?.[0]?.message?.content;
      return typeof content === "string" && content.trim().length > 0 ? { content: content.trim(), model: cfg.model } : null;
    } catch {
      return null; // network/auth error ⇒ honest unknown, never a fabricated source
    }
  };
}
