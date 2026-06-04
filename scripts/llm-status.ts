/**
 * scripts/llm-status.ts
 *
 * llm:status — print the resolved LLM Gateway configuration. Shows provider
 * mode, the network gate, model, and which providers are available. NEVER
 * prints the API key (only whether one is present). No network call.
 *
 * Usage:
 *   npm run llm:status
 */

import { resolveLlmConfig, selectProviderMode } from "../src/llm/index.js";

const config = resolveLlmConfig();
const effective = selectProviderMode(config);

console.log("\nHartOS LLM Gateway — Status: test-agent");
console.log(`Configured provider:   ${config.provider}`);
console.log(`Effective provider:    ${effective}`);
console.log(`Model:                 ${config.model}`);
console.log(`Network gate enabled:  ${config.networkEnabled} (HARTOS_LLM_ENABLE_NETWORK)`);
console.log(`OpenAI key present:    ${config.apiKeyPresent}`);
console.log(`Deterministic ready:   true (always available, offline)`);
if (effective === "deterministic") {
  console.log("\nMode: deterministic/fallback — no network calls will be made.");
  if (config.provider === "openai") {
    console.log("OpenAI requested but gated off (set HARTOS_LLM_ENABLE_NETWORK=true and OPENAI_API_KEY).");
  }
} else {
  console.log("\nMode: openai — gated on. Real network calls will be made on demand.");
}
console.log("");
