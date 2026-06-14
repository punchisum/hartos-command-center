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
 *   Returns degraded:true — the brain ran but gathered NO sources, so the council synthesis
 *   correctly EXCLUDES it from the confidence floor (avoids dragging medium/high specialists down).
 *   Map ResearchConfidence → CouncilBrains confidence:
 *     "unknown" → "low"   (the dossier knows nothing — floor at low)
 *     "low"     → "low"
 *     "medium"  → "medium"
 *     "high"    → "high"
 *   summary = first line of executiveSummary (the dossier's own honest "no sources gathered"
 *             statement), or the fallback sentinel if absent.
 *   risks   = top N unknowns, each prefixed "Unknown: ".
 *
 * FULL (opt-in, requires TWO gates all truthy):
 *   HARTOS_RESEARCH_COUNCIL_LIGHTWEIGHT=false   ← the adapter flag (absent/other → lightweight)
 *   HARTOS_RESEARCH_GATHER=true                 ← the existing gather arm flag
 *   Plus: CLAUDE_CODE_OAUTH_TOKEN present       ← Claude-on-Max is the reliable gather provider
 *   (OpenAI key / HARTOS_LLM_ENABLE_NETWORK no longer required for full-gather;
 *    the adapter now uses buildClaudeSourceFetcher — Max plan OAuth, not pay-per-token.)
 *   When gates are set: plan → buildClaudeSourceFetcher → gatherSources → synthesizeResearch.
 *   If Claude token absent or gathering yields zero sources → fall back to lightweight (degraded:true).
 *   A successful gather (≥1 source) → degraded:false, confidence per dossier.
 *   NO laundering: real findings only when at least one source was actually gathered.
 *
 * NEVER THROWS — every path is wrapped; errors → degraded sentinel.
 *
 * NODE EXECUTION HOST ONLY.  Keep out of the Worker bundle.
 */

import { planResearch } from "./research-planner.js";
import { synthesizeResearch, type ResearchConfidence } from "./research-synthesis.js";
import { gatherSources } from "./research-gatherer.js";
import { buildClaudeSourceFetcher, buildClaudeResearchInfer, type ClaudeResearchInfer } from "./research-claude.js";
import { researchGatherArmed } from "./run-research-gather.js";
import { RESEARCH_AGENT_SPEC } from "../agents/research-agent-spec.js";
import type { CouncilGoal } from "../council/council-types.js";

type Env = Record<string, string | undefined>;

/** The council-brain result shape (matches CouncilBrains.research / BrainResult). */
export interface CouncilBrainResult {
  summary: string;
  confidence: "low" | "medium" | "high";
  risks: string[];
  /**
   * When true, the brain ran but gathered no real sources (lightweight or zero-gather).
   * The council synthesis excludes degraded findings from the confidence floor.
   */
  degraded: boolean;
}

// ── Flag names ──────────────────────────────────────────────────────────────

/** Set HARTOS_RESEARCH_COUNCIL_LIGHTWEIGHT=false to opt into full-gather mode. */
export const COUNCIL_RESEARCH_LIGHTWEIGHT_FLAG = "HARTOS_RESEARCH_COUNCIL_LIGHTWEIGHT";

/** Maximum number of unknowns to surface as risks. */
const MAX_RISKS = 4;

// ── Flag predicates ──────────────────────────────────────────────────────────

/**
 * Returns true (lightweight) by default. Only false when:
 *   - HARTOS_RESEARCH_COUNCIL_LIGHTWEIGHT is explicitly "false", AND
 *   - HARTOS_RESEARCH_GATHER=true (the gather arm flag), AND
 *   - CLAUDE_CODE_OAUTH_TOKEN is present (Claude-on-Max is the reliable gather provider).
 * This keeps the adapter ZERO-COST on a plain run.
 */
export function isLightweightMode(env: Env = process.env): boolean {
  const flag = String(env[COUNCIL_RESEARCH_LIGHTWEIGHT_FLAG] ?? "").trim().toLowerCase();
  // Only opt out of lightweight when EXPLICITLY set to "false".
  if (flag !== "false") return true;
  // Also require the gather arm flag to be true.
  if (!researchGatherArmed(env)) return true;
  // Require CLAUDE_CODE_OAUTH_TOKEN for the Claude-on-Max gather path.
  const claudeToken = (env["CLAUDE_CODE_OAUTH_TOKEN"] ?? "").trim();
  if (!claudeToken) return true;
  // All gates are armed — full mode is allowed.
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
  degraded: true,
};

const NOW_ISO = () => new Date().toISOString();

/**
 * Lightweight path: plan + synthesize with EMPTY sources → honest unknowns.
 * Pure, deterministic, zero network/cost. Returns degraded:true because no sources
 * were actually gathered — the council synthesis will exclude this from the confidence floor.
 */
function lightweightResult(goal: string): CouncilBrainResult {
  const plan = planResearch(goal);
  const dossier = synthesizeResearch(plan, [], { now: NOW_ISO() });
  const summary = dossier.executiveSummary[0] ?? "(no findings yet — sources not gathered)";
  const confidence = mapConfidence(dossier.confidence);
  const risks = dossier.unknowns.slice(0, MAX_RISKS).map((u) => `Unknown: ${u}`);
  // degraded:true — lightweight ran but gathered ZERO sources; synthesis excludes from floor.
  return { summary, confidence, risks, degraded: true };
}

// ── Public entry ─────────────────────────────────────────────────────────────

/**
 * The research "brain" for the P7 council.
 *
 * Satisfies `CouncilBrains.research: (goal: CouncilGoal) => Promise<CouncilBrainResult>`.
 *
 * - NEVER throws (all paths wrapped; errors → degraded sentinel).
 * - LIGHTWEIGHT by default (no cost, no network, no LLM). Returns degraded:true.
 * - FULL mode requires HARTOS_RESEARCH_COUNCIL_LIGHTWEIGHT=false + HARTOS_RESEARCH_GATHER=true
 *   + CLAUDE_CODE_OAUTH_TOKEN (Claude-on-Max). Returns degraded:false only when ≥1 source gathered.
 * - Full mode uses Claude-on-Max (reliable; not rate-limited like OpenAI/Gemini).
 * - Real findings (degraded:false) only when sources were actually gathered — NO laundering.
 *
 * @param infer Optional injectable Claude research infer (for testing; defaults to buildClaudeResearchInfer).
 */
export async function researchCouncilBrain(
  goal: CouncilGoal,
  env: Env = process.env,
  infer?: ClaudeResearchInfer,
): Promise<CouncilBrainResult> {
  try {
    const lightweight = isLightweightMode(env);

    if (lightweight) {
      return lightweightResult(goal.goal);
    }

    // ── FULL MODE ────────────────────────────────────────────────────────────
    // All gates have passed in isLightweightMode — proceed to gather via Claude-on-Max.
    let plan;
    try {
      plan = planResearch(goal.goal);
    } catch {
      return lightweightResult(goal.goal);
    }

    const now = NOW_ISO();
    // Use the injected infer (tests) or build Claude-on-Max infer from env.
    const claudeInfer = infer ?? buildClaudeResearchInfer(env);
    const fetcher = buildClaudeSourceFetcher({ topic: plan.question, now, env, infer: claudeInfer });
    let gathered;
    try {
      gathered = await gatherSources(plan, {
        boundary: RESEARCH_AGENT_SPEC.boundary,
        fetcher,
        now,
        armed: researchGatherArmed(env),
      });
    } catch {
      // gatherSources should not throw, but be safe — fall back to lightweight.
      return lightweightResult(goal.goal);
    }

    // Honesty gate: if nothing was actually gathered → fall back to lightweight (degraded:true).
    if (gathered.sources.length === 0) {
      return lightweightResult(goal.goal);
    }

    // Real sources gathered → non-degraded finding.
    const dossier = synthesizeResearch(plan, gathered.sources, { now });
    const summary = dossier.executiveSummary[0] ?? "(no summary produced)";
    const confidence = mapConfidence(dossier.confidence);
    const risks = dossier.unknowns.slice(0, MAX_RISKS).map((u) => `Unknown: ${u}`);
    // degraded:false — real sources were gathered, this finding counts for the confidence floor.
    return { summary, confidence, risks, degraded: false };
  } catch {
    // Last-resort safety net — the adapter must never throw.
    return DEGRADED_RESULT;
  }
}
