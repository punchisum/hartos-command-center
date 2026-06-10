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

/**
 * Read the API key at call time only — never stored, never logged. Prefers the config-threaded key
 * (resolved from the Worker `env`) so the call works even when `process.env` is empty under
 * nodejs_compat; falls back to `process.env` for the Node/CLI path.
 */
function readApiKey(config?: LlmGatewayConfig): string | undefined {
  const fromConfig = config?.apiKey;
  if (typeof fromConfig === "string" && fromConfig.trim().length > 0) return fromConfig.trim();
  const key = process.env["OPENAI_API_KEY"];
  return key && key.trim().length > 0 ? key.trim() : undefined;
}

/**
 * Build the chat-completions request body. Classic chat models (gpt-3.x / gpt-4.x) accept an
 * explicit `temperature: 0` for determinism; gpt-5.x and o-series reasoning models REJECT a
 * non-default temperature (HTTP 400), so it is set ONLY for the models that support it. JSON
 * output is requested for every model (the validator enforces shape; the gateway falls back).
 */
export function buildChatRequestBody(config: LlmGatewayConfig, req: LlmRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: "system", content: buildSystemPrompt(req.type) },
      { role: "user", content: buildUserPrompt(req) },
    ],
    response_format: { type: "json_object" },
  };
  if (/^(gpt-3|gpt-4)/.test(config.model)) body.temperature = 0;
  return body;
}

export const openAiProvider: LlmProvider = {
  name: "openai",
  async generate(req: LlmRequest, config: LlmGatewayConfig): Promise<unknown> {
    // Defense in depth: refuse to reach the network unless explicitly gated on.
    if (!config.networkEnabled) {
      throw new OpenAiProviderError("Network disabled (HARTOS_LLM_ENABLE_NETWORK!=true).");
    }
    const apiKey = readApiKey(config);
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
        body: JSON.stringify(buildChatRequestBody(config, req)),
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
