/**
 * src/llm/providers/gemini-provider.ts
 *
 * The Google Gemini adapter — the ONLY place a Gemini network call may originate.
 *
 * Mirrors the OpenAI adapter's contract exactly so the gateway can treat them interchangeably:
 *   - MUST NOT be invoked unless the gateway resolved networkEnabled === true AND a key is present.
 *   - returns RAW (unvalidated) output for central validation + fallback.
 *   - never logs the API key or the raw prompt; errors are redacted.
 *
 * Gemini speaks `generateContent` (not chat/completions): a system instruction, a user `parts`
 * array, and `generationConfig.responseMimeType="application/json"` to force a JSON object. The
 * shared prompt-contract (buildSystemPrompt/buildUserPrompt) already specifies the exact JSON
 * shape; the central validator enforces it and the gateway falls back on any drift.
 *
 * Tests never exercise the network path: the default provider is deterministic and the gemini
 * provider is only reached when HARTOS_LLM_PROVIDER=gemini + network gate + GEMINI_API_KEY.
 */

import type { LlmGatewayConfig, LlmProvider, LlmRequest } from "../llm-types.js";
import { buildSystemPrompt, buildUserPrompt } from "../prompt-contracts.js";
import { redact } from "../redaction.js";

/** v1beta generateContent. The key travels in the `x-goog-api-key` header, never the URL. */
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiProviderError extends Error {}

/**
 * Read the Gemini key at call time only — never stored, never logged. Prefers the config-threaded
 * key (resolved from the Worker `env`) so the call works even when `process.env` is empty under
 * nodejs_compat; falls back to `process.env` for the Node/CLI path.
 */
function readApiKey(config?: LlmGatewayConfig): string | undefined {
  const fromConfig = config?.geminiApiKey;
  if (typeof fromConfig === "string" && fromConfig.trim().length > 0) return fromConfig.trim();
  const key = process.env["GEMINI_API_KEY"];
  return key && key.trim().length > 0 ? key.trim() : undefined;
}

/**
 * Build the generateContent request body. systemInstruction carries the contract prompt; the user
 * turn carries the request; responseMimeType forces a JSON object; temperature 0 for determinism.
 */
export function buildGeminiRequestBody(config: LlmGatewayConfig, req: LlmRequest): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: buildSystemPrompt(req.type) }] },
    contents: [{ role: "user", parts: [{ text: buildUserPrompt(req) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0,
    },
  };
}

/** Transient statuses worth one quick retry before ceding to the fallback provider. */
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pull the model's text out of a generateContent response (first candidate, concatenated parts). */
function extractText(payload: unknown): string | null {
  const parts = (payload as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
  })?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
  return text.length > 0 ? text : null;
}

export const geminiProvider: LlmProvider = {
  name: "gemini",
  async generate(req: LlmRequest, config: LlmGatewayConfig): Promise<unknown> {
    // Defense in depth: refuse to reach the network unless explicitly gated on.
    if (!config.networkEnabled) {
      throw new GeminiProviderError("Network disabled (HARTOS_LLM_ENABLE_NETWORK!=true).");
    }
    const apiKey = readApiKey(config);
    if (!apiKey) {
      throw new GeminiProviderError("GEMINI_API_KEY is not set.");
    }
    const model = (config.geminiModel ?? config.model ?? "").trim();
    if (!model) {
      throw new GeminiProviderError("No Gemini model configured.");
    }

    const url = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`;
    const bodyJson = JSON.stringify(buildGeminiRequestBody(config, req));

    // Retry transient overload (429/5xx — Gemini flash spikes) before ceding to the OpenAI fallback,
    // so a momentary "high demand" 503 doesn't degrade the primary path. Hard errors fail fast.
    let res: Response | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: bodyJson,
        });
      } catch (err) {
        if (attempt < MAX_ATTEMPTS) {
          await sleep(300 * attempt);
          continue;
        }
        throw new GeminiProviderError(`Gemini request failed: ${redact(String(err))}`);
      }
      if (res.ok) break;
      if (TRANSIENT_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
        await sleep(300 * attempt);
        continue;
      }
      throw new GeminiProviderError(`Gemini returned status ${res.status}.`);
    }
    if (!res || !res.ok) {
      throw new GeminiProviderError(`Gemini unavailable after ${MAX_ATTEMPTS} attempt(s).`);
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch (err) {
      throw new GeminiProviderError(`Gemini response was not JSON: ${redact(String(err))}`);
    }

    const content = extractText(payload);
    if (content === null) {
      throw new GeminiProviderError("Gemini response missing candidate text.");
    }
    try {
      return JSON.parse(content);
    } catch {
      // Return raw string so the validator rejects it and the gateway falls back.
      return content;
    }
  },
};
