/**
 * src/llm/prompt-contracts.ts
 *
 * The structured output contract + prompt builders shared by providers and the
 * validator. There is exactly one output shape so the gateway can validate
 * centrally and fall back safely on malformed responses.
 */

import type { LlmRequest } from "./llm-types.js";

export const ALLOWED_CONFIDENCE = ["low", "medium", "high"] as const;
export const ALLOWED_RISK = ["low", "medium", "high"] as const;
/**
 * The only domains a provider may claim. Anything else fails validation and the
 * gateway falls back to the deterministic provider — a network provider cannot
 * steer routing/risk by inventing a domain.
 */
export const ALLOWED_DOMAINS = ["finance", "fitness", "ops", "factory", "general"] as const;

export const OUTPUT_KEYS = [
  "intent",
  "domain",
  "confidence",
  "neededContext",
  "recommendedSpecialist",
  "riskLevel",
  "nextAction",
  "summary",
] as const;

/** Validation bounds — keep outputs small and safe. */
export const MAX_STRING_LENGTH = 600;
export const MAX_ARRAY_LENGTH = 12;
export const MAX_ARRAY_ITEM_LENGTH = 80;

/** A short, machine-readable description of the JSON contract. */
export const OUTPUT_CONTRACT_DESCRIPTION = JSON.stringify({
  intent: "string",
  domain: "finance|fitness|ops|factory|general",
  confidence: "low|medium|high",
  neededContext: ["string"],
  recommendedSpecialist: "string",
  riskLevel: "low|medium|high",
  nextAction: "string",
  summary: "string",
});

export function buildSystemPrompt(): string {
  return [
    "You are the HartOS reasoning assistant. You SUGGEST and CONTEXTUALIZE only.",
    "You never mutate anything and you never request actions be executed.",
    "Respond with a single JSON object and nothing else.",
    `The JSON must match this contract exactly: ${OUTPUT_CONTRACT_DESCRIPTION}`,
    "Do not include secrets, tokens, or API keys in your response.",
  ].join("\n");
}

export function buildUserPrompt(req: LlmRequest): string {
  const ctx = req.context ? JSON.stringify(req.context) : "{}";
  return [
    `Request type: ${req.type}`,
    `Request: ${req.request}`,
    `Deterministic context (already-known facts): ${ctx}`,
    "Return only the JSON object described in the system prompt.",
  ].join("\n");
}
