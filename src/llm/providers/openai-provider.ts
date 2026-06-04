/**
 * src/llm/providers/openai-provider.ts
 *
 * The OpenAI adapter. It is the ONLY place an OpenAI network call may originate.
 *
 * Hard rules:
 *   - It MUST NOT be invoked unless the gateway resolved networkEnabled === true
 *     AND an API key is present. The gateway enforces provider selection; this
 *     adapter additionally refuses to call out when the network gate is off.
 *   - It returns RAW output for central validation.
 *   - It never logs the API key or the raw prompt; errors are redacted.
 *
 * Tests never exercise the network path: the default provider is deterministic
 * and HARTOS_LLM_ENABLE_NETWORK is not set.
 */

import type { LlmGatewayConfig, LlmProvider, LlmRequest } from "../llm-types.js";
import { buildSystemPrompt, buildUserPrompt } from "../prompt-contracts.js";
import { redact } from "../redaction.js";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

export class OpenAiProviderError extends Error {}

/** Read the API key at call time only — never stored, never logged. */
function readApiKey(): string | undefined {
  const key = process.env["OPENAI_API_KEY"];
  return key && key.trim().length > 0 ? key.trim() : undefined;
}

export const openAiProvider: LlmProvider = {
  name: "openai",
  async generate(req: LlmRequest, config: LlmGatewayConfig): Promise<unknown> {
    // Defense in depth: refuse to reach the network unless explicitly gated on.
    if (!config.networkEnabled) {
      throw new OpenAiProviderError("Network disabled (HARTOS_LLM_ENABLE_NETWORK!=true).");
    }
    const apiKey = readApiKey();
    if (!apiKey) {
      throw new OpenAiProviderError("OPENAI_API_KEY is not set.");
    }

    let res: Response;
    try {
      res = await fetch(OPENAI_CHAT_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: buildSystemPrompt() },
            { role: "user", content: buildUserPrompt(req) },
          ],
          response_format: { type: "json_object" },
          temperature: 0,
        }),
      });
    } catch (err) {
      throw new OpenAiProviderError(`OpenAI request failed: ${redact(String(err))}`);
    }

    if (!res.ok) {
      throw new OpenAiProviderError(`OpenAI returned status ${res.status}.`);
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch (err) {
      throw new OpenAiProviderError(`OpenAI response was not JSON: ${redact(String(err))}`);
    }

    const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
      ?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new OpenAiProviderError("OpenAI response missing message content.");
    }
    try {
      return JSON.parse(content);
    } catch {
      // Return raw string so the validator rejects it and the gateway falls back.
      return content;
    }
  },
};
