/**
 * src/llm/ask-llm.ts
 *
 * Worker-safe Ask-LLM ORCHESTRATOR (LLM ASK plan 2A).
 *
 * Produces an Ask answer that is RULE-BASED by default and LLM-enriched only
 * when an `AskInfer` function is injected. Doctrine:
 *   - The LLM may REASON / PROPOSE, NEVER execute or approve (`proposeOnly: true`).
 *   - NO secret ever reaches a prompt: the request is REDACTED before infer is
 *     called, and the context is deep-redacted (§16, redact FIRST).
 *   - The provider call itself runs Node/Edge (the gateway is key-bearing); this
 *     module is PURE and Worker-safe, so it MUST NOT import `llm-gateway.ts`
 *     (which pulls node:path/fs). The inference is INJECTED instead.
 *   - Honest fallback: any null/invalid/throwing infer collapses to the
 *     deterministic grounding — never a laundered or fabricated answer.
 *
 * No fs/network/clock/env. Fully unit-testable offline with a fake infer.
 */

import { redact, redactDeep } from "./redaction.js";
import { validateLlmOutput } from "./output-validator.js";
import type { LlmResult } from "./llm-types.js";
import type { RiskLevel } from "../hartos/orchestrator-types.js";

/**
 * The injected inference boundary (SHARED CONTRACT — the Node/Edge runner's
 * production implementation wraps the gated `LlmGateway`; tests inject a fake).
 * Receives an ALREADY-REDACTED request and an already-deep-redacted context.
 * Returns null when the LLM is disarmed/unavailable.
 */
export type AskInfer = (
  redactedRequest: string,
  context?: Record<string, unknown>
) => Promise<LlmResult | null>;

/**
 * Minimal deterministic answer the orchestrator is grounded by. This is the
 * rule-based truth the cockpit already computes today; the LLM may only enrich
 * it, never override its gaps/freshness.
 */
export interface AskGrounding {
  summary: string;
  title?: string;
  highlights?: string[];
  gaps?: string[];
}

/** The composed Ask answer. Always honest about whether the LLM was used. */
export interface AskLlmAnswer {
  mode: "llm" | "deterministic";
  provider: string;
  usedLlm: boolean;
  title: string;
  summary: string;
  highlights: string[];
  gaps: string[];
  riskLevel: RiskLevel;
  /** Doctrine invariant: the LLM may reason/propose, NEVER execute/approve. */
  proposeOnly: true;
  /** The redacted request that was (or would have been) forwarded to infer. */
  redactedRequest: string;
  validation: string;
  /**
   * When the answer is deterministic, WHY the LLM wasn't used — so "no live LLM" is never silent.
   * "disarmed" = no infer / infer returned null (gate closed or unavailable); "infer-threw" =
   * the provider errored; "malformed-output" = the LLM replied but failed validation; "none" = LLM used.
   */
  fallbackReason: "disarmed" | "infer-threw" | "malformed-output" | "none";
}

const DEFAULT_TITLE = "Ask HartOS";

function groundingTitle(grounding: AskGrounding): string {
  return typeof grounding.title === "string" && grounding.title.length > 0
    ? grounding.title
    : DEFAULT_TITLE;
}

function groundingHighlights(grounding: AskGrounding): string[] {
  return Array.isArray(grounding.highlights) ? [...grounding.highlights] : [];
}

function groundingGaps(grounding: AskGrounding): string[] {
  return Array.isArray(grounding.gaps) ? [...grounding.gaps] : [];
}

/** Build the honest deterministic answer straight from the grounding. */
function deterministicAnswer(
  grounding: AskGrounding,
  redactedRequest: string,
  validation: string,
  fallbackReason: AskLlmAnswer["fallbackReason"] = "disarmed"
): AskLlmAnswer {
  return {
    mode: "deterministic",
    provider: "deterministic",
    usedLlm: false,
    title: groundingTitle(grounding),
    summary: grounding.summary,
    highlights: groundingHighlights(grounding),
    gaps: groundingGaps(grounding),
    // Deterministic ground truth is read-only and carries no inherent action risk.
    riskLevel: "low",
    proposeOnly: true,
    redactedRequest,
    validation,
    fallbackReason,
  };
}

/**
 * Compose an Ask answer.
 *
 * Behaviour-preserving by default: with no `infer`, the answer IS the
 * deterministic grounding. With an `infer`, the request is redacted first, the
 * LLM is consulted, its output is validated, and on success the answer is the
 * LLM reasoning GROUNDED by the deterministic facts (citing the deterministic
 * gaps, risk-rated, propose-only). Any failure collapses to the deterministic
 * answer — honestly labelled.
 */
export async function composeAskAnswer(
  grounding: AskGrounding,
  request: string,
  context: Record<string, unknown> | undefined,
  deps: { infer?: AskInfer }
): Promise<AskLlmAnswer> {
  // Redact FIRST so the ORIGINAL request never reaches infer (§16). Done even
  // on the no-infer path so `redactedRequest` is always set and honest.
  const redactedRequest = redact(request);

  if (!deps.infer) {
    return deterministicAnswer(grounding, redactedRequest, "deterministic", "disarmed");
  }

  // Ground the LLM in the deterministic FACTS so it synthesizes FROM them instead of
  // reasoning blind (which laundered confidence + invented generic gaps). The grounding is
  // the authoritative source; the model writes a narrative summary over these exact facts.
  const groundingContext = {
    title: groundingTitle(grounding),
    summary: grounding.summary,
    highlights: groundingHighlights(grounding),
    gaps: groundingGaps(grounding),
  };
  const safeContext = redactDeep({ ...(context ?? {}), grounding: groundingContext });

  let result: LlmResult | null;
  try {
    result = await deps.infer(redactedRequest, safeContext);
  } catch {
    // Infer threw (e.g. network/provider error) — honest deterministic fallback.
    return deterministicAnswer(grounding, redactedRequest, "fallback", "infer-threw");
  }

  if (result === null || result === undefined) {
    // Disarmed/unavailable — honest deterministic fallback.
    return deterministicAnswer(grounding, redactedRequest, "fallback", "disarmed");
  }

  const validation = validateLlmOutput(result.output);
  if (!validation.ok || !validation.value) {
    // Malformed LLM output — never launder it; fall back to deterministic truth.
    return deterministicAnswer(grounding, redactedRequest, "fallback", "malformed-output");
  }

  const out = validation.value;
  const detGaps = groundingGaps(grounding);
  const detHighlights = groundingHighlights(grounding);

  // LLM reasoning GROUNDED by the deterministic facts: the LLM summary leads,
  // but the deterministic gaps/freshness are always cited so the model can
  // never silently override what the rule-based layer actually knows.
  const highlights = [...detHighlights];
  if (out.recommendedSpecialist.length > 0) {
    highlights.push(`Recommended: ${out.recommendedSpecialist}`);
  }
  if (out.nextAction.length > 0) {
    // Surface the next action as a PROPOSAL, never an executable instruction.
    highlights.push(`Proposed next action: ${out.nextAction}`);
  }

  const gaps = [...detGaps];
  for (const needed of out.neededContext) {
    if (!gaps.includes(needed)) gaps.push(needed);
  }

  // Honesty: the gateway may return a VALID structured output that was produced deterministically
  // (gate closed) or by fallback. Only a real NETWORK-mode result (openai or gemini — the chain's
  // two live providers) counts as "LLM used" — never launder. (This check predating the Gemini
  // migration mislabeled every real Gemini answer "deterministic / LLM gate off".)
  const usedRealLlm = result.mode === "openai" || result.mode === "gemini";
  return {
    mode: usedRealLlm ? "llm" : "deterministic",
    provider: result.provider,
    usedLlm: usedRealLlm,
    title: groundingTitle(grounding),
    summary: out.summary,
    highlights,
    gaps,
    // Risk is taken from the validated LLM output (already constrained to
    // low|medium|high by the validator).
    riskLevel: out.riskLevel as RiskLevel,
    proposeOnly: true,
    redactedRequest,
    validation: result.validation,
    fallbackReason: usedRealLlm ? "none" : result.mode === "fallback" ? "infer-threw" : "disarmed",
  };
}
