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
import { councilClaudeInfer } from "./council-claude-infer.js";

/** The structured return type shared by all brain adapters (research, beezulbub, etc.). */
export interface BrainResult {
  summary: string;
  confidence: "low" | "medium" | "high";
  risks: string[];
  /**
   * When true, the brain did NOT actually investigate (e.g. lightweight/fixture mode with no real
   * sources). The council synthesis EXCLUDES degraded findings from the confidence floor so that a
   * lightweight brain running in zero-cost mode does not drag the floor down when the real
   * specialists (CTO/Financial/M&A/Legal) return medium/high confidence.
   */
  degraded?: boolean;
}

/** The brain adapters the council uses. Only research is required; others optional. */
export interface CouncilBrains {
  /**
   * The research brain: takes a CouncilGoal and returns a structured finding.
   * Use the real Research agent when available; a deterministic adapter is fine for this slice.
   * When the brain ran lightweight/gathered no sources, it SHOULD set degraded:true.
   */
  research: (goal: CouncilGoal) => Promise<BrainResult>;
  /**
   * Beezulbub capability-scout + tech-landscape lens (optional).
   * When present, a deterministic brain specialist is added after research.
   * Default: fixture-only (zero cost, zero network). Live scouting requires
   * BEEZULBUB_ALLOW_NETWORK=true in the env (authoritative gate in scout.ts).
   * When fixture-only with zero candidates, it SHOULD set degraded:true.
   */
  beezulbub?: (goal: CouncilGoal) => Promise<BrainResult>;
  // prophet and rinnegan remain optional; they will be wired when those brains are trivially callable.
  prophet?: (goal: CouncilGoal) => Promise<BrainResult>;
  rinnegan?: (goal: CouncilGoal) => Promise<BrainResult>;
}

/**
 * Assemble the council specialists.
 *
 * Base set (always present): research + cto + financial + ma + legal.
 * Optional brain specialists (added when the brain is provided):
 *   - beezulbub: capability scouting + tech landscape due-diligence (after research, before LLM specialists).
 *
 * @param infer   The council Infer seam (system+user prompt → raw model text). See councilInferFromEnv.
 * @param brains  The deterministic brain adapters (research required; beezulbub optional).
 * @returns       Array of Specialists in DEFAULT_ROSTER order (beezulbub inserted after research when present).
 */
export function buildCouncilSpecialists(infer: Infer, brains: CouncilBrains): Specialist[] {
  const specialists: Specialist[] = [
    // Deterministic brain specialist — research lens.
    makeBrainSpecialist("research", "prior art, market landscape, and domain facts", brains.research),
  ];

  // Optional: Beezulbub capability-scout brain (after research, before LLM specialists).
  if (brains.beezulbub !== undefined) {
    specialists.push(
      makeBrainSpecialist(
        "beezulbub",
        "capability scouting + tech landscape due-diligence",
        brains.beezulbub
      )
    );
  }

  // LLM specialists for the domain lenses.
  specialists.push(
    makeLlmSpecialist("cto", infer),
    makeLlmSpecialist("financial", infer),
    makeLlmSpecialist("ma", infer),
    makeLlmSpecialist("legal", infer)
  );

  return specialists;
}

type Env = Record<string, string | undefined>;

/**
 * Select the best available council Infer for the given environment.
 *
 * If CLAUDE_CODE_OAUTH_TOKEN is present, the headless-Claude path (councilClaudeInfer) is used —
 * it routes through the Max-plan subscription and does NOT touch Gemini/OpenAI keys.
 * Otherwise, falls back to councilInferFromEnv (the governed LlmGateway path).
 *
 * Keep this a thin selector: all business logic lives in the respective implementations.
 */
export function selectCouncilInfer(env: Env): Infer {
  const hasToken = !!(env["CLAUDE_CODE_OAUTH_TOKEN"] ?? "").trim();
  if (hasToken) return councilClaudeInfer(env);
  return councilInferFromEnv(env);
}

/**
 * Build a council-scoped Infer backed by the governed LlmGateway.
 *
 * Calls gateway.runCouncilSpecialist() which uses the isolated council_specialist prompt contract
 * and validator — so the model reasons through the specialist's own lens and returns real
 * { summary, confidence, risks } instead of being forced through the generic 8-field classifier
 * (which ignored the lens and hardcoded risks:[]).
 *
 * HONEST FALLBACK: a real specialist finding is forwarded ONLY when a real network provider answered
 * AND result.output is present. When the LLM gate is off — gateway returns output:null for
 * deterministic/fallback mode — this returns an honest LOW-confidence stub whose summary admits the
 * LLM was unavailable. That keeps the confidence band truthful (a stub never claims "medium") and
 * conservatively floors synthesis to low — it never launders a stub into a confident finding for
 * synthesis or the P8 memory signal.
 *
 * @param env   Process environment.  Defaults to empty (deterministic) when omitted.
 */
export function councilInferFromEnv(env: Env): Infer {
  const gateway = new LlmGateway({ env });

  return async (prompt: { system: string; user: string }): Promise<string> => {
    // Combine system + user into a single request string the gateway understands.
    // runCouncilSpecialist uses the isolated council_specialist prompt + validator.
    const request = `${prompt.system}\n\n${prompt.user}`;
    try {
      const result = await gateway.runCouncilSpecialist(request);
      // result.output is non-null only when a real provider answered with a valid council shape.
      // For deterministic/fallback mode the gateway returns output:null — fall through to honest stub.
      const realLlm = result.ok && result.mode !== "deterministic" && result.mode !== "fallback";
      if (realLlm && result.output) {
        // The model returned real { summary, confidence, risks } via the specialist lens — forward it.
        return JSON.stringify(result.output);
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
