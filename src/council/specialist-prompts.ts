/**
 * src/council/specialist-prompts.ts
 *
 * Defines the 5 council specialist lenses, builds a redacted prompt for each
 * specialist, and fail-closed parses SpecialistFinding from raw model text.
 */

import { redact } from "../llm/redaction.js";
import { SpecialistFinding, isConfidence } from "./council-types.js";

/** The 5 council lenses, keyed by specialist id. */
export const SPECIALIST_LENSES: Record<string, string> = {
  research: "prior art, market landscape, and domain facts",
  cto: "technical feasibility, architecture, effort estimation, and technical risk",
  financial: "cost, burn rate, runway, and cost-vs-benefit analysis",
  ma: "build vs. buy vs. partner; acquisition and integration angle",
  legal: "compliance, liability, regulatory and contractual surface",
};

/**
 * Build a redacted prompt pair for the given specialist.
 * The `user` field has all secrets scrubbed via `redact`.
 * Unknown specialist ids fall back to a generic role — never throws.
 */
export function buildSpecialistPrompt(
  id: string,
  goal: { goal: string; context?: string }
): { system: string; user: string } {
  const lens = SPECIALIST_LENSES[id] ?? "general analysis";

  const system =
    `You are a specialist advisor focused on: ${lens}. ` +
    `Evaluate the goal provided and return ONLY a JSON object with exactly these fields: ` +
    `{"summary": "<string>", "confidence": "<low|medium|high>", "risks": ["<string>", ...]}. ` +
    `Do not include any text outside the JSON object.`;

  const rawUser =
    `Goal: ${goal.goal}` +
    (goal.context ? `\n\nContext:\n${goal.context}` : "");

  const user = redact(rawUser);

  return { system, user };
}

/**
 * Parse a SpecialistFinding from raw model text.
 * Tolerates code-fence wrapping. Never throws — any failure produces a
 * degraded finding with confidence "low".
 */
export function parseFinding(id: string, rawText: string): SpecialistFinding {
  const lens = SPECIALIST_LENSES[id] ?? id;

  const degraded: SpecialistFinding = {
    specialistId: id,
    lens,
    summary: "(unparseable specialist output)",
    confidence: "low",
    risks: [],
    degraded: true,
  };

  try {
    // Strip optional markdown code-fence wrapping: ```json ... ``` or ``` ... ```
    let text = rawText.trim();
    const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (fenceMatch) {
      text = fenceMatch[1].trim();
    }

    const parsed: unknown = JSON.parse(text);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return degraded;
    }

    const obj = parsed as Record<string, unknown>;

    const summary = obj["summary"];
    if (typeof summary !== "string" || summary.trim() === "") {
      return degraded;
    }

    const confidence = obj["confidence"];
    if (!isConfidence(confidence)) {
      return degraded;
    }

    const rawRisks = obj["risks"];
    const risks: string[] = Array.isArray(rawRisks)
      ? rawRisks.filter((r): r is string => typeof r === "string")
      : [];

    return {
      specialistId: id,
      lens,
      summary: summary.trim(),
      confidence,
      risks,
      degraded: false,
    };
  } catch {
    return degraded;
  }
}
