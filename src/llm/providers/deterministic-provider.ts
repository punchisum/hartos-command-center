/**
 * src/llm/providers/deterministic-provider.ts
 *
 * The always-available, offline provider. It produces a valid structured output
 * purely from the request text + provided deterministic context using simple,
 * stable keyword heuristics. No network, no randomness, no secrets.
 *
 * This is also the fallback the gateway uses when a real provider returns
 * malformed output or is not configured.
 */

import type { LlmProvider, LlmRequest, LlmStructuredOutput } from "../llm-types.js";
import { redact } from "../redaction.js";

interface DomainRule {
  domain: string;
  specialist: string;
  keywords: string[];
}

const DOMAIN_RULES: DomainRule[] = [
  { domain: "finance", specialist: "finance_agent", keywords: ["stock", "market", "watchlist", "tax", "invoice", "finance", "budget", "money", "portfolio"] },
  { domain: "fitness", specialist: "fitness_agent", keywords: ["fitness", "workout", "recovery", "training", "health", "nutrition", "sleep", "whoop", "hrv"] },
  { domain: "ops", specialist: "ops_agent", keywords: ["ops", "clickup", "card", "project", "task", "sync", "import", "operation"] },
  { domain: "factory", specialist: "factory", keywords: ["build", "agent", "factory", "scaffold", "specialist", "create", "generate"] },
];

const RISK_KEYWORDS = ["deploy", "delete", "mutate", "production", "promote", "migrate", "send", "charge", "payment"];

/** Inspectable domain classification — exposes the score + matched keywords so it is never silent. */
export interface DomainClassification {
  domain: string;
  specialist: string;
  /** Number of keyword hits for the winning rule (0 ⇒ no domain matched). */
  score: number;
  matched: string[];
}

/**
 * Classify a domain from text by keyword hits. Honest: a zero-score result returns the explicit
 * "general"/"orchestrator" fallback (never a falsely-asserted specialist). PURE.
 */
export function classifyDomain(text: string): DomainClassification {
  const lower = (text || "").toLowerCase();
  let best: DomainRule | null = null;
  let bestScore = 0;
  let matched: string[] = [];
  for (const rule of DOMAIN_RULES) {
    const hits = rule.keywords.filter((kw) => lower.includes(kw));
    if (hits.length > bestScore) {
      bestScore = hits.length;
      best = rule;
      matched = hits;
    }
  }
  if (!best || bestScore === 0) return { domain: "general", specialist: "orchestrator", score: 0, matched: [] };
  return { domain: best.domain, specialist: best.specialist, score: bestScore, matched };
}

function clamp(text: string, max = 600): string {
  const safe = redact(text);
  return safe.length > max ? `${safe.slice(0, max - 1)}…` : safe;
}

export function deterministicOutput(req: LlmRequest): LlmStructuredOutput {
  // Classify over the REQUEST only — NOT the grounding context. The Ask grounding is full of
  // fitness/ops panel data; folding it into classification mis-routed a war/economy question to
  // "fitness". The user's question is the only honest intent signal here.
  const cls = classifyDomain(req.request);
  const matchedDomain = cls.score > 0;
  const lower = req.request.toLowerCase();
  const risky = RISK_KEYWORDS.some((kw) => lower.includes(kw));
  const contextKeys = req.context ? Object.keys(req.context).slice(0, 12) : [];

  return {
    intent: clamp(req.type, 80),
    domain: cls.domain,
    confidence: req.request.trim().length === 0 ? "low" : matchedDomain ? "medium" : "low",
    neededContext: contextKeys.length > 0 ? contextKeys : ["recent_reports"],
    recommendedSpecialist: cls.specialist,
    riskLevel: risky ? "high" : "low",
    nextAction: "review_local_reports",
    summary: clamp(
      `Deterministic ${req.type.replace(/_/g, " ")} for a ${matchedDomain ? cls.domain : "general"} request` +
        `${matchedDomain ? "" : " (no domain keyword matched)"}: "${req.request}". ` +
        `No live LLM was used; this is a safe offline summary.`
    ),
  };
}

export const deterministicProvider: LlmProvider = {
  name: "deterministic",
  async generate(req: LlmRequest): Promise<unknown> {
    return deterministicOutput(req);
  },
};
