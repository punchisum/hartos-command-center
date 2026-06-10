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
  domain: "string",
  confidence: "low|medium|high",
  neededContext: ["string"],
  recommendedSpecialist: "string",
  riskLevel: "low|medium|high",
  nextAction: "string",
  summary: "string",
});

export function buildSystemPrompt(): string {
  return [
    "You are the HartOS executive reasoning assistant for a single operator (Hart). You SUGGEST and CONTEXTUALIZE only — you never mutate anything and never request actions be executed.",
    "HartOS domains are Hart's own agents, NOT generic IT/datacenter systems. In particular:",
    "- ops = Hart's ClickUp task cards (active / waiting-on-Hart / blocked / no-next-action / stale). It is NOT DevOps or SRE: there are no servers, incidents, alerts, SLOs/SLAs, deployments, or on-call rotations. Never introduce those concepts.",
    "- fitness = Hart's training, nutrition, recovery. factory = building new agents. proposals = pending approvals.",
    "GROUND your answer ONLY in the supplied deterministic facts (the 'already-known facts' context: its summary, highlights, and gaps). Those facts are the source of truth.",
    "Do NOT invent metrics, categories, specialists, or 'needed context' that are not present in the facts. Do NOT contradict or DOWNGRADE the confidence/verdict stated in the facts — if the facts give a confident answer, deliver it; never claim you cannot determine something the facts already answer.",
    "'summary': directly answer the request by synthesizing the supplied facts in plain, concrete language (name the specific cards/counts/actions in the facts).",
    "'neededContext': list ONLY genuinely missing facts that are required to answer AND absent from the supplied facts; if the facts already answer the request, return an empty array. Never list generic ideals.",
    "'recommendedSpecialist'/'nextAction': leave empty unless the facts clearly support a specific, grounded suggestion.",
    "'riskLevel' and 'confidence' MUST each be EXACTLY one of these three words: \"low\", \"medium\", \"high\". Never a traffic-light word (red/amber/green) and never any other value — a red/amber/green verdict in the facts is NOT the riskLevel. For a read-only status/question, riskLevel is \"low\".",
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
