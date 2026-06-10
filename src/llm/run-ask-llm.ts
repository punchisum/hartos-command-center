/**
 * src/llm/run-ask-llm.ts
 *
 * Node/Edge RUNNER for the Ask-LLM reasoning slice (LLM ASK 2A).
 *
 * This module builds a production `AskInfer` from the existing governed
 * {@link LlmGateway}. It is the ONLY half of the Ask-LLM spine permitted to
 * import the gateway (the gateway pulls node:path, so it is Node/Edge-only and
 * Worker-unsafe). The sibling orchestrator (src/llm/ask-llm.ts) owns the
 * `AskInfer` contract and stays Worker-safe by taking the inference fn injected.
 *
 * SAFETY / DOCTRINE:
 *   - The gateway SELF-GATES: a real OpenAI network call only happens when its
 *     gate is open — HARTOS_LLM_PROVIDER=openai AND HARTOS_LLM_ENABLE_NETWORK=true
 *     AND OPENAI_API_KEY present. Otherwise it runs the deterministic provider.
 *   - DEFAULT = deterministic. No network, no key, no real call by default.
 *   - Tests inject a mock provider (LlmGatewayOptions.providers) so NO real
 *     network ever occurs offline.
 *   - The orchestrator redacts BEFORE calling this fn (§16); the runner only
 *     ever sees the already-redacted request string.
 *   - The runner NEVER throws: the gateway already falls back to deterministic
 *     and never throws, but we still guard and return null on any error so the
 *     orchestrator can apply its rule-based fallback.
 *   - LLM may reason/propose, NEVER execute/approve — this runner only reads.
 */

import type { AskInfer } from "./ask-llm.js";
import { LlmGateway } from "./llm-gateway.js";
import type { LlmGatewayOptions } from "./llm-gateway.js";

export interface BuildAskInferOptions {
  /** Environment used to resolve the gateway gate. Defaults to process.env via the gateway. */
  env?: Record<string, string | undefined>;
  /** Provider overrides — tests inject mocks so no real network occurs. */
  providers?: LlmGatewayOptions["providers"];
  /** Pre-constructed gateway (takes precedence over env/providers). */
  gateway?: LlmGateway;
}

/**
 * Construct an {@link AskInfer} backed by the governed {@link LlmGateway}.
 *
 * The returned fn takes the orchestrator's already-REDACTED request string plus
 * optional deterministic context, runs it through the gateway's
 * `classifyAndContextualize` capability, and returns the resulting `LlmResult`.
 * It returns `null` on a falsy/failed result or on any thrown error, so the
 * orchestrator can fall back to its rule-based path.
 *
 * The gateway gate decides whether a real OpenAI call happens; by default it is
 * deterministic and makes NO network call. Tests inject a mock provider.
 */
export function buildAskInfer(opts: BuildAskInferOptions = {}): AskInfer {
  const gateway =
    opts.gateway ??
    new LlmGateway({
      ...(opts.env ? { env: opts.env } : {}),
      ...(opts.providers ? { providers: opts.providers } : {}),
    });

  return async (redactedRequest, context) => {
    try {
      // Intent-specialized reasoning: a strategy question gets the strategist prompt, a build/CTO
      // question gets the CTO prompt; everything else keeps the general classify path. The intent
      // rides in the (already-redacted) context the orchestrator forwards. All three self-gate
      // identically — a real OpenAI call still requires the armed gate; otherwise deterministic.
      const intent = typeof context?.["intent"] === "string" ? (context["intent"] as string) : "";
      const result =
        intent === "strategy_review"
          ? await gateway.runStrategyReasoning(redactedRequest, context)
          : intent === "build_agent"
            ? await gateway.runCtoReasoning(redactedRequest, context)
            : await gateway.classifyAndContextualize(redactedRequest, context);
      if (!result || result.success !== true) {
        return null;
      }
      return result;
    } catch {
      // The gateway already self-guards, but never let the runner throw.
      return null;
    }
  };
}
