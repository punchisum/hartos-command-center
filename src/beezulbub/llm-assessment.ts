/**
 * src/beezulbub/llm-assessment.ts — NODE host: LLM-deepened capability due-diligence (Option 2).
 *
 * Beezulbub's scout/score is heuristic (stars, recency, keyword relevance). This adds a REASONED
 * read per candidate — maintenance health, security posture, license/doctrine risk, HartOS fit, and
 * an absorb/reject lean — by riding the SAME gated LLM path the Research Agent uses (research-llm).
 * Honesty floor inherited: returns null unless a real model answered; a stub/error is never dressed
 * up as analysis. Doctrine carried into the prompt: absorb ability, reject poison, never auto-copy.
 */

import { buildResearchInfer, type ResearchInfer } from "../research/research-llm.js";
import type { ScoutCandidate } from "./types.js";

export interface CapabilityAssessment {
  name: string;
  /** Free-text reasoned assessment (model output) — advisory, not a vetted verdict. */
  assessment: string;
}

export type CapabilityAssessor = (candidate: ScoutCandidate) => Promise<CapabilityAssessment | null>;

/** Build a gated capability assessor. `infer` is injectable for tests (no real network). */
export function buildCapabilityAssessor(
  env: Record<string, string | undefined> = process.env,
  infer?: ResearchInfer,
): CapabilityAssessor {
  const research = infer ?? buildResearchInfer(env);
  return async (c) => {
    const prompt =
      `Assess this open-source candidate for absorption into HartOS. Doctrine: absorb ability, reject poison, ` +
      `standardise to HartOS, never auto-copy code. Candidate: ${c.name}. What it offers: ${c.reason}. ` +
      `License: ${c.licenseGuess ?? "unknown"}. Signals: ${c.notes || "n/a"}. Stale-risk: ${c.staleRisk}. ` +
      `Give a concise read on: maintenance health, security posture, license/doctrine risk, HartOS fit, ` +
      `and a lean (DEVOUR / PARTIAL / REFERENCE-ONLY / REJECT) with a one-line rationale. ` +
      `Be concrete; if you are unsure, say so; never invent specifics.`;
    const r = await research(prompt, `absorb ${c.targetCapability}: ${c.name}`);
    return r ? { name: c.name, assessment: r.content } : null;
  };
}

/** Assess the top-N candidates (by value), skipping nulls. Pure orchestration over the assessor. */
export async function assessTopCandidates(
  candidates: ScoutCandidate[],
  assess: CapabilityAssessor,
  topN = 3,
): Promise<CapabilityAssessment[]> {
  const top = [...candidates].sort((a, b) => b.estimatedValue - a.estimatedValue).slice(0, topN);
  const out: CapabilityAssessment[] = [];
  for (const c of top) {
    try {
      const a = await assess(c);
      if (a) out.push(a);
    } catch {
      /* a failed assessment is simply omitted — never a fabricated one */
    }
  }
  return out;
}
