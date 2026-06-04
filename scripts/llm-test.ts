/**
 * scripts/llm-test.ts
 *
 * llm:test — run one gateway reasoning call and print the structured result.
 * Deterministic fallback unless HARTOS_LLM_PROVIDER=openai AND the network gate
 * is enabled AND a key is present. Writes a redacted usage log under
 * llm-reports/. No secrets are printed.
 *
 * Usage:
 *   npm run llm:test -- --request="What should I build next?"
 */

import { LlmGateway } from "../src/llm/index.js";

function arg(name: string, fallback: string): string {
  const found = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(`--${name}=`.length) : fallback;
}

const request = arg("request", "What should I build next?");

const gateway = new LlmGateway({ writeUsage: true, cwd: process.cwd() });
const result = await gateway.classifyAndContextualize(request, { source: "llm:test" });

console.log("\nHartOS LLM Gateway — Test: test-agent");
console.log(`Request:        ${request}`);
console.log(`Provider:       ${result.provider}`);
console.log(`Mode:           ${result.mode}`);
console.log(`Validation:     ${result.validation}`);
console.log("Structured output:");
console.log(JSON.stringify(result.output, null, 2));
console.log("\nUsage log written under llm-reports/ (redacted; no secrets).\n");
