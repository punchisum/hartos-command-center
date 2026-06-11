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

import { resolveLlmConfig, selectProviderMode, providerChain } from "../src/llm/index.js";

const config = resolveLlmConfig();
const effective = selectProviderMode(config);
const chain = providerChain(config);

console.log("\nHartOS LLM Gateway — Status: test-agent");
console.log(`Configured primary:    ${config.provider}`);
console.log(`Effective provider:    ${effective}`);
console.log(`Provider chain:        ${chain.length ? chain.join(" → ") + " → deterministic" : "deterministic only"}`);
console.log(`Gemini model:          ${config.geminiModel} (HARTOS_GEMINI_MODEL)`);
console.log(`OpenAI model:          ${config.openaiModel} (HARTOS_LLM_MODEL)`);
console.log(`Network gate enabled:  ${config.networkEnabled} (HARTOS_LLM_ENABLE_NETWORK)`);
console.log(`Gemini key present:    ${config.geminiKeyPresent === true}`);
console.log(`OpenAI key present:    ${config.openaiKeyPresent === true}`);
console.log(`Deterministic ready:   true (always available, offline)`);
if (effective === "deterministic") {
  console.log("\nMode: deterministic/fallback — no network calls will be made.");
  if (config.provider !== "deterministic") {
    const keyName = config.provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
    console.log(`${config.provider} requested but gated off (set HARTOS_LLM_ENABLE_NETWORK=true and ${keyName}).`);
  }
} else {
  console.log(`\nMode: ${effective} — gated on. Real network calls will be made on demand (fallback: ${chain.slice(1).join(", ") || "deterministic"}).`);
}
console.log("");
