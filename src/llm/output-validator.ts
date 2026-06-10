/**
 * src/llm/output-validator.ts
 *
 * Centrally validates provider output against the structured contract. Malformed
 * output never crashes the gateway — it is reported and the caller falls back to
 * the deterministic provider. Token-like strings are rejected outright.
 */

import type { LlmStructuredOutput, OutputValidation } from "./llm-types.js";
import {
  ALLOWED_CONFIDENCE,
  ALLOWED_RISK,
  MAX_ARRAY_ITEM_LENGTH,
  MAX_ARRAY_LENGTH,
  MAX_STRING_LENGTH,
  OUTPUT_KEYS,
} from "./prompt-contracts.js";
import { containsSecret } from "./redaction.js";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function badString(v: unknown): boolean {
  return typeof v !== "string" || v.length === 0 || v.length > MAX_STRING_LENGTH || containsSecret(v);
}

/**
 * Like badString but allows an EMPTY string — for advisory/optional fields
 * (recommendedSpecialist, nextAction) where "none" is a legitimate, honest answer.
 * A grounded model should leave these empty rather than invent a specialist/action.
 */
function badOptionalString(v: unknown): boolean {
  return typeof v !== "string" || v.length > MAX_STRING_LENGTH || containsSecret(v);
}

/** Validate raw provider output. Never throws. */
export function validateLlmOutput(raw: unknown): OutputValidation {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "Output is not a JSON object." };
  }

  for (const key of OUTPUT_KEYS) {
    if (!(key in raw)) return { ok: false, error: `Missing required key: ${key}` };
  }

  const { intent, domain, confidence, neededContext, recommendedSpecialist, riskLevel, nextAction, summary } = raw;

  // Core fields must be present + non-empty; advisory fields may be empty ("none").
  for (const [name, value] of Object.entries({ intent, domain, summary })) {
    if (badString(value)) return { ok: false, error: `Invalid string field: ${name}` };
  }
  for (const [name, value] of Object.entries({ recommendedSpecialist, nextAction })) {
    if (badOptionalString(value)) return { ok: false, error: `Invalid string field: ${name}` };
  }

  if (typeof confidence !== "string" || !ALLOWED_CONFIDENCE.includes(confidence as never)) {
    return { ok: false, error: `confidence must be one of ${ALLOWED_CONFIDENCE.join("|")}` };
  }
  if (typeof riskLevel !== "string" || !ALLOWED_RISK.includes(riskLevel as never)) {
    return { ok: false, error: `riskLevel must be one of ${ALLOWED_RISK.join("|")}` };
  }

  if (!Array.isArray(neededContext) || neededContext.length > MAX_ARRAY_LENGTH) {
    return { ok: false, error: `neededContext must be an array of <= ${MAX_ARRAY_LENGTH} items` };
  }
  for (const item of neededContext) {
    if (typeof item !== "string" || item.length === 0 || item.length > MAX_ARRAY_ITEM_LENGTH || containsSecret(item)) {
      return { ok: false, error: "neededContext contains an invalid item" };
    }
  }

  const value: LlmStructuredOutput = {
    intent: intent as string,
    domain: domain as string,
    confidence: confidence as LlmStructuredOutput["confidence"],
    neededContext: neededContext as string[],
    recommendedSpecialist: recommendedSpecialist as string,
    riskLevel: riskLevel as LlmStructuredOutput["riskLevel"],
    nextAction: nextAction as string,
    summary: summary as string,
  };
  return { ok: true, value };
}
