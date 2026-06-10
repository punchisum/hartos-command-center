/**
 * src/llm/prompt-contracts.ts
 *
 * The structured output contract + prompt builders shared by providers and the
 * validator. There is exactly one output shape so the gateway can validate
 * centrally and fall back safely on malformed responses.
 */

import type { LlmRequest, LlmRequestType } from "./llm-types.js";

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
/**
 * The synthesized answer (`summary`) gets a larger ceiling than other fields: the deterministic
 * `answerOps`/`answerDailyBrief` builders already emit multi-line briefs, so a 600-char cap would
 * force the LLM to compress BELOW the rule-based baseline it is meant to enrich. Still bounded +
 * secret-scanned, so the larger cap carries no safety cost.
 */
export const MAX_SUMMARY_LENGTH = 2000;
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

/**
 * A short role specialization appended to the base prompt for the reasoning-heavy request types, so
 * a strategy question is answered by a strategist and a build/CTO question by an engineer-leader —
 * instead of every Ask getting the same generic classifier voice. Still propose-only; still grounded
 * ONLY in the supplied facts. Returns "" for the default classify/summarize types (unchanged).
 */
function specializationFor(requestType?: LlmRequestType): string {
  switch (requestType) {
    case "strategy_reasoning":
      return (
        "ROLE: Reason as Hart's STRATEGY advisor. Lead with the single highest-leverage next move, then the key " +
        "tradeoffs and sequencing — what to do first, what to defer, and why — grounded strictly in the supplied facts. " +
        "Be decisive: a recommendation, not a survey. Still propose-only; never invent facts or actions beyond them."
      );
    case "cto_reasoning":
      return (
        "ROLE: Reason as Hart's CTO. Focus on technical feasibility, architecture, capability gaps, and build-vs-buy, " +
        "grounded strictly in the supplied facts. Name the concrete next engineering step and its main risk. Still " +
        "propose-only; never invent capabilities, metrics, or actions not present in the facts."
      );
    default:
      return "";
  }
}

export function buildSystemPrompt(requestType?: LlmRequestType): string {
  const specialization = specializationFor(requestType);
  return [
    "You are the HartOS executive reasoning assistant for a single operator (Hart). You SUGGEST and CONTEXTUALIZE only — you never mutate anything and never request actions be executed.",
    ...(specialization ? [specialization] : []),
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
  const ctx = (req.context && typeof req.context === "object" ? req.context : {}) as Record<string, unknown>;
  const lines: string[] = [`Request type: ${req.type}`, `Request: ${req.request}`];
  const used = new Set<string>();

  const pushText = (label: string, v: unknown): void => {
    if (v == null) return;
    const s = String(v).trim();
    if (s) lines.push(`${label}:`, s);
  };
  const pushList = (label: string, v: unknown): void => {
    if (!Array.isArray(v)) return;
    const items = v.map((x) => (x == null ? "" : String(x).trim())).filter(Boolean).map((x) => `- ${x}`);
    if (items.length) lines.push(`${label}:`, ...items);
  };

  // Render the high-signal deterministic facts as LABELED, READABLE sections rather than one
  // escaped JSON.stringify blob (which mangles quotes and buries the signal the model needs). The
  // authoritative facts arrive nested under `grounding` (see ask-llm.ts); the Rinnegan fleet
  // briefing, when present, is top-level. Nothing is dropped — residual keys still ride as JSON.
  const grounding = ctx["grounding"];
  if (grounding && typeof grounding === "object" && !Array.isArray(grounding)) {
    used.add("grounding");
    const g = grounding as Record<string, unknown>;
    pushText("Already-known facts — summary", g["summary"]);
    pushList("Already-known facts — highlights", g["highlights"]);
    pushList("Already-known facts — gaps", g["gaps"]);
  }
  if (typeof ctx["rinneganBriefing"] === "string") {
    used.add("rinneganBriefing");
    pushText("Fleet briefing (Rinnegan)", ctx["rinneganBriefing"]);
  }

  const residual: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) if (!used.has(k)) residual[k] = v;
  if (Object.keys(residual).length) {
    lines.push(`Other deterministic context (JSON): ${JSON.stringify(residual)}`);
  }

  lines.push("Return only the JSON object described in the system prompt.");
  return lines.join("\n");
}
