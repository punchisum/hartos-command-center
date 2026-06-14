/**
 * src/council/council-specialists.ts
 *
 * P7 Council — live specialist wiring (Task 2.3).
 *
 * buildCouncilSpecialists: assembles the 5 Specialists for a council run.
 *   - cto / financial / ma / legal → LLM specialists via makeLlmSpecialist(id, infer)
 *   - research → brain specialist via makeBrainSpecialist("research", "prior-art", brains.research)
 *
 * councilInferFromEnv: builds a council-scoped Infer from the live LLM gateway.
 *   Honest fallback to a deterministic stub when the LLM gate is off.  Never throws.
 *
 * NODE EXECUTION HOST ONLY — imports LlmGateway (pulls node:path/fs).
 * The council Infer type matches specialist.ts Infer, not AskInfer, because
 * council specialists pass system+user prompts directly (not via ask-llm's
 * classify_and_contextualize shape).
 */

import { LlmGateway } from "../llm/llm-gateway.js";
import type { Specialist, Infer } from "./specialist.js";
import type { CouncilGoal } from "./council-types.js";
import { makeLlmSpecialist, makeBrainSpecialist } from "./specialist.js";

/** The brain adapters the council uses. Only research is required; others optional. */
export interface CouncilBrains {
  /**
   * The research brain: takes a CouncilGoal and returns a structured finding.
   * Use the real Research agent when available; a deterministic adapter is fine for this slice.
   */
  research: (goal: CouncilGoal) => Promise<{ summary: string; confidence: "low" | "medium" | "high"; risks: string[] }>;
  // prophet and rinnegan remain optional; they will be wired when those brains are trivially callable.
  prophet?: (goal: CouncilGoal) => Promise<{ summary: string; confidence: "low" | "medium" | "high"; risks: string[] }>;
  rinnegan?: (goal: CouncilGoal) => Promise<{ summary: string; confidence: "low" | "medium" | "high"; risks: string[] }>;
}

/**
 * Assemble the 5 council specialists.
 *
 * @param infer   The council Infer seam (system+user prompt → raw model text). See councilInferFromEnv.
 * @param brains  The deterministic brain adapters.
 * @returns       Array of 5 Specialists in the DEFAULT_ROSTER order.
 */
export function buildCouncilSpecialists(infer: Infer, brains: CouncilBrains): Specialist[] {
  return [
    // Deterministic brain specialist — research lens.
    makeBrainSpecialist("research", "prior art, market landscape, and domain facts", brains.research),
    // LLM specialists for the new domains.
    makeLlmSpecialist("cto", infer),
    makeLlmSpecialist("financial", infer),
    makeLlmSpecialist("ma", infer),
    makeLlmSpecialist("legal", infer),
  ];
}

type Env = Record<string, string | undefined>;

/**
 * Build a council-scoped Infer backed by the governed LlmGateway.
 *
 * The council Infer takes { system, user } and calls the gateway's strategy-reasoning capability
 * (a natural fit for specialist advisor prompts).  When the LLM gate is off (default), the gateway
 * answers deterministically and `summarize` extracts a stub string — never throws.
 *
 * HONEST FALLBACK: when the gateway returns no usable output, the infer returns a JSON string with
 * confidence="low" and a summary that admits the LLM was unavailable.  This degrades the specialist
 * finding to "degraded=true" via parseFinding, which is the honest outcome and exactly the right
 * behaviour per the spec.
 *
 * @param env   Process environment.  Defaults to empty (deterministic) when omitted.
 */
export function councilInferFromEnv(env: Env): Infer {
  const gateway = new LlmGateway({ env });

  return async (prompt: { system: string; user: string }): Promise<string> => {
    // Combine system + user into a single request string the gateway understands.
    // The gateway's strategy_reasoning capability is the best semantic fit.
    const request = `${prompt.system}\n\n${prompt.user}`;
    try {
      const result = await gateway.runStrategyReasoning(request);
      if (result && result.success && result.output) {
        // The gateway returns a structured LlmStructuredOutput.  The council's parseFinding expects
        // a raw JSON string of { summary, confidence, risks }.  Extract the usable fields.
        const { summary, confidence } = result.output;
        if (summary && typeof summary === "string" && summary.trim().length > 0) {
          const safeConf = confidence === "low" || confidence === "medium" || confidence === "high" ? confidence : "low";
          return JSON.stringify({ summary: summary.trim(), confidence: safeConf, risks: [] });
        }
      }
    } catch {
      // Gateway threw (should never happen — it self-guards) — fall through to honest stub.
    }
    // Honest deterministic fallback: deterministic gateway or no usable output.
    // This produces a degraded finding via parseFinding, which is correct and honest.
    return JSON.stringify({
      summary: "(LLM unavailable — deterministic stub; finding is degraded)",
      confidence: "low",
      risks: ["LLM gateway not armed or returned no usable output"],
    });
  };
}
