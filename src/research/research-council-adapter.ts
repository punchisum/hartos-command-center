/**
 * src/research/research-council-adapter.ts
 *
 * P7 Council Seam 2 — wires the REAL Research agent as the council's "research" brain.
 *
 * `researchCouncilBrain(goal, env?)` satisfies the `CouncilBrains.research` signature and
 * replaces the deterministic placeholder in scripts/run-council-pass.ts.
 *
 * TWO MODES (selected by env flag — lightweight is the default):
 *
 * LIGHTWEIGHT (default, zero cost):
 *   planResearch(goal.goal) → synthesizeResearch(plan, [], opts) with EMPTY gathered sources.
 *   The dossier honestly lists every sub-question as an unknown ("not yet" ≠ fabrication).
 *   Map ResearchConfidence → CouncilBrains confidence:
 *     "unknown" → "low"   (the dossier knows nothing — floor at low)
 *     "low"     → "low"
 *     "medium"  → "medium"
 *     "high"    → "high"
 *   summary = first line of executiveSummary (the dossier's own honest "no sources gathered"
 *             statement), or the fallback sentinel if absent.
 *   risks   = top N unknowns, each prefixed "Unknown: ".
 *
 * FULL (opt-in, requires THREE gates all truthy):
 *   HARTOS_RESEARCH_COUNCIL_LIGHTWEIGHT=false   ← the new adapter flag (absent/other → lightweight)
 *   HARTOS_RESEARCH_GATHER=true                 ← the existing gather arm flag
 *   buildResearchInfer(env) gate (provider + network + key) ← the LLM gate
 *   When all three are set: plan → buildLlmSourceFetcher → gatherSources → synthesizeResearch.
 *   If gathering yields zero sources (or throws) → fall back to lightweight (honest unknowns).
 *   NO laundering: real findings only when at least one source was actually gathered.
 *
 * NEVER THROWS — every path is wrapped; errors → degraded sentinel.
 *
 * NODE EXECUTION HOST ONLY.  Keep out of the Worker bundle.
 */

import { planResearch } from "./research-planner.js";
import { synthesizeResearch, type ResearchConfidence } from "./research-synthesis.js";
import { gatherSources } from "./research-gatherer.js";
import { buildLlmSourceFetcher, researchGatherArmed } from "./run-research-gather.js";
import { buildResearchInfer } from "./research-llm.js";
import { RESEARCH_AGENT_SPEC } from "../agents/research-agent-spec.js";
import type { CouncilGoal } from "../council/council-types.js";

type Env = Record<string, string | undefined>;

/** The council-brain result shape (matches CouncilBrains.research). */
export interface CouncilBrainResult {
  summary: string;
  confidence: "low" | "medium" | "high";
  risks: string[];
}

// ── Flag names ──────────────────────────────────────────────────────────────

/** Set HARTOS_RESEARCH_COUNCIL_LIGHTWEIGHT=false to opt into full-gather mode. */
export const COUNCIL_RESEARCH_LIGHTWEIGHT_FLAG = "HARTOS_RESEARCH_COUNCIL_LIGHTWEIGHT";

/** Maximum number of unknowns to surface as risks. */
const MAX_RISKS = 4;

// ── Flag predicates ──────────────────────────────────────────────────────────

/**
 * Returns true (lightweight) by default.  Only false when the flag is explicitly "false"
 * AND the gather arm flag is true AND the LLM infer gate would pass.
 * This keeps the adapter ZERO-COST on a plain run.
 */
export function isLightweightMode(env: Env = process.env): boolean {
  const flag = String(env[COUNCIL_RESEARCH_LIGHTWEIGHT_FLAG] ?? "").trim().toLowerCase();
  // Only opt out of lightweight when EXPLICITLY set to "false".
  if (flag !== "false") return true;
  // Also require the gather arm flag to be true.
  if (!researchGatherArmed(env)) return true;
  // Also require the LLM gate to be armed (provider/network/key).
  const infer = buildResearchInfer(env);
  // The infer fn is synchronous to build; we detect its gate via a canary sub-call.
  // But we cannot await here in a sync predicate.  We keep a cheaper check:
  // the existing researchGatherArmed already verifies HARTOS_RESEARCH_GATHER; we
  // additionally require HARTOS_LLM_ENABLE_NETWORK=true as a proxy for the LLM gate.
  const networkEnabled = String(env["HARTOS_LLM_ENABLE_NETWORK"] ?? "").trim().toLowerCase() === "true";
  const keyPresent = Boolean((env["OPENAI_API_KEY"] ?? "").trim());
  if (!networkEnabled || !keyPresent) return true;
  // All three gates are armed — full mode is allowed.
  return false;
}

// ── Confidence mapping ───────────────────────────────────────────────────────

/** Map ResearchDossier confidence (includes "unknown") to CouncilBrains confidence. */
export function mapConfidence(rc: ResearchConfidence): "low" | "medium" | "high" {
  if (rc === "unknown" || rc === "low") return "low";
  if (rc === "medium") return "medium";
  return "high";
}

// ── Core helpers ─────────────────────────────────────────────────────────────

const DEGRADED_RESULT: CouncilBrainResult = {
  summary: "(research agent failed — degraded)",
  confidence: "low",
  risks: ["Research agent encountered an internal error"],
};

const NOW_ISO = () => new Date().toISOString();

/**
 * Lightweight path: plan + synthesize with EMPTY sources → honest unknowns.
 * Pure, deterministic, zero network/cost.
 */
function lightweightResult(goal: string): CouncilBrainResult {
  const plan = planResearch(goal);
  const dossier = synthesizeResearch(plan, [], { now: NOW_ISO() });
  const summary = dossier.executiveSummary[0] ?? "(no findings yet — sources not gathered)";
  const confidence = mapConfidence(dossier.confidence);
  const risks = dossier.unknowns.slice(0, MAX_RISKS).map((u) => `Unknown: ${u}`);
  return { summary, confidence, risks };
}

// ── Public entry ─────────────────────────────────────────────────────────────

/**
 * The research "brain" for the P7 council.
 *
 * Satisfies `CouncilBrains.research: (goal: CouncilGoal) => Promise<CouncilBrainResult>`.
 *
 * - NEVER throws (all paths wrapped; errors → degraded sentinel).
 * - LIGHTWEIGHT by default (no cost, no network, no LLM).
 * - FULL mode requires three explicit env gates (see module doc).
 * - Real findings only when sources were actually gathered — NO laundering.
 */
export async function researchCouncilBrain(
  goal: CouncilGoal,
  env: Env = process.env,
): Promise<CouncilBrainResult> {
  try {
    const lightweight = isLightweightMode(env);

    if (lightweight) {
      return lightweightResult(goal.goal);
    }

    // ── FULL MODE ────────────────────────────────────────────────────────────
    // All three gates have passed in isLightweightMode — proceed to gather.
    let plan;
    try {
      plan = planResearch(goal.goal);
    } catch {
      return lightweightResult(goal.goal);
    }

    const now = NOW_ISO();
    const infer = buildResearchInfer(env);
    const fetcher = buildLlmSourceFetcher({ topic: plan.question, now, env, infer });
    const gathered = await gatherSources(plan, {
      boundary: RESEARCH_AGENT_SPEC.boundary,
      fetcher,
      now,
      armed: researchGatherArmed(env),
    });

    // Honesty gate: if nothing was actually gathered → fall back to lightweight.
    if (gathered.sources.length === 0) {
      return lightweightResult(goal.goal);
    }

    const dossier = synthesizeResearch(plan, gathered.sources, { now });
    const summary = dossier.executiveSummary[0] ?? "(no summary produced)";
    const confidence = mapConfidence(dossier.confidence);
    const risks = dossier.unknowns.slice(0, MAX_RISKS).map((u) => `Unknown: ${u}`);
    return { summary, confidence, risks };
  } catch {
    // Last-resort safety net — the adapter must never throw.
    return DEGRADED_RESULT;
  }
}
