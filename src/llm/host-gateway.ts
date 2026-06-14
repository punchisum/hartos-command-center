/**
 * src/llm/host-gateway.ts
 *
 * HOST-ONLY helper for wiring the claude-max provider into the LLM gateway.
 *
 * Usage (host / daemon / scripts only — never in the Cloudflare Worker):
 *
 *   import { hostExtraProviders, buildHostGateway } from "../llm/host-gateway.js";
 *
 *   // Option A — convenience factory (recommended):
 *   const gw = buildHostGateway(process.env);
 *   const result = await gw.classifyAndContextualize("my request");
 *
 *   // Option B — inject extraProviders manually (e.g. when you already have a config):
 *   const gw = new LlmGateway({
 *     config: { ...resolveLlmConfig(env), provider: "claude-max" },
 *     extraProviders: hostExtraProviders(env),
 *   });
 *
 * Why HOST-ONLY:
 *   `claude-max-provider.ts` imports node:child_process. This file imports that
 *   module, so it MUST NEVER be imported by cloudflare-cockpit-worker.ts or
 *   run-ask-llm.ts (which the Worker imports). The Worker's gateway is wired
 *   without extraProviders; only host callers (Ask CLI, scripts, daemon) use this.
 *
 * When CLAUDE_CODE_OAUTH_TOKEN is absent the extra-providers map is empty, so
 * `providerChain` produces no claude-max slot → the gateway is deterministic (safe
 * degradation). Pass gemini/openai keys alongside for API-key fallback on error.
 */

import { LlmGateway, resolveLlmConfig } from "./llm-gateway.js";
import { claudeMaxProvider } from "./providers/claude-max-provider.js";
import type { LlmProvider, LlmProviderMode } from "./llm-types.js";

type Env = Record<string, string | undefined>;

/**
 * Return the extra-providers map for host callers.
 * Contains "claude-max" iff CLAUDE_CODE_OAUTH_TOKEN is present; otherwise empty.
 * Empty map → providerChain has no claude-max slot → gateway degrades gracefully.
 */
export function hostExtraProviders(env: Env = process.env): Partial<Record<LlmProviderMode, LlmProvider>> {
  const token = env["CLAUDE_CODE_OAUTH_TOKEN"];
  const hasToken = typeof token === "string" && token.trim().length > 0;
  if (!hasToken) return {};
  return { "claude-max": claudeMaxProvider };
}

/**
 * Build an LlmGateway configured for the host/daemon with claude-max as PRIMARY
 * and gemini → openai as fallback (when their keys are present). The config's
 * provider is forced to "claude-max" so providerChain puts it first.
 *
 * Falls back gracefully when the token / API keys are absent:
 *   - No CLAUDE_CODE_OAUTH_TOKEN → extraProviders is empty → chain is gemini/openai/deterministic.
 *   - No gemini/openai keys → chain is deterministic.
 *
 * @param env  The process environment (or a Worker-env-like object for testing).
 * @returns    A ready LlmGateway — call `.classifyAndContextualize()` etc.
 */
export function buildHostGateway(env: Env = process.env): LlmGateway {
  const config = {
    ...resolveLlmConfig(env),
    // Override provider to "claude-max" so providerChain puts it first.
    provider: "claude-max" as LlmProviderMode,
    // networkEnabled must be true for the gemini/openai fallback slots to be eligible.
    // claude-max itself doesn't check this flag (it gates on token presence).
    networkEnabled: env["HARTOS_LLM_ENABLE_NETWORK"] === "true",
  };

  return new LlmGateway({
    env,
    config,
    extraProviders: hostExtraProviders(env),
  });
}
