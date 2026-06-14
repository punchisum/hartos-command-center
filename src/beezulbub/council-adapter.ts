/**
 * src/beezulbub/council-adapter.ts
 *
 * P7 Council seam — wires Beezulbub as the council's "capability scouting +
 * tech landscape due-diligence" brain.
 *
 * `beezulbubCouncilBrain(goal, env?)` satisfies the optional `CouncilBrains.beezulbub`
 * signature and replaces the absent scouting perspective in council runs.
 *
 * MODES:
 *   FIXTURE (default, zero cost, zero network):
 *     allowNetwork = false → autoScoutForSpec uses fixture registry only.
 *     Honest "no candidates found — fixture scout" when the registry has no entry.
 *     Returns degraded:true when zero candidates found (fixture didn't really scout).
 *
 *   LIVE (opt-in):
 *     BEEZULBUB_ALLOW_NETWORK=true in env (the authoritative gate, read by scout.ts).
 *     This adapter forwards allowNetwork=true only when the env gate is set.
 *     Still requires GITHUB_TOKEN for real GitHub calls.
 *     Returns degraded:false when real candidates are found; degraded:true when zero candidates.
 *
 * CONFIDENCE MAPPING (0-1 number → council band):
 *   >= 0.7  → "high"
 *   >= 0.4  → "medium"
 *   < 0.4   → "low"
 *   FLOOR rule: 0 candidates OR high unknowns (>= 3) → forced "low" regardless.
 *   NEVER launders upward (plan §19 invariant).
 *
 * DEGRADED FLAG:
 *   degraded:true  → zero candidates (fixture or live miss); excluded from confidence floor.
 *   degraded:false → real candidates found (live scouting with results).
 *
 * NEVER THROWS — every path is wrapped; errors → degraded sentinel.
 *
 * NODE EXECUTION HOST ONLY.  Keep out of the Worker bundle.
 */

import { autoScoutForSpec } from "./auto-scout.js";
import type { BeezulbubCapabilityReport } from "./types.js";
import type { CouncilGoal } from "../council/council-types.js";

type Env = Record<string, string | undefined>;

/** The council-brain result shape (matches CouncilBrains.beezulbub / BrainResult). */
export interface BeezulbubCouncilBrainResult {
  summary: string;
  confidence: "low" | "medium" | "high";
  risks: string[];
  /**
   * When true, the brain ran but found zero candidates (fixture-only or live miss).
   * The council synthesis excludes degraded findings from the confidence floor.
   */
  degraded: boolean;
}

/** Maximum number of risk items to surface. */
const MAX_RISKS = 4;

/** Degraded sentinel — returned when the adapter itself errors. */
const DEGRADED_RESULT: BeezulbubCouncilBrainResult = {
  summary: "(Beezulbub scout unavailable — degraded)",
  confidence: "low",
  risks: ["Beezulbub council adapter encountered an internal error"],
  degraded: true,
};

// ── Flag names ──────────────────────────────────────────────────────────────

/** Read by scout.ts; this adapter checks it to forward intent, never writes it. */
const ALLOW_NETWORK_FLAG = "BEEZULBUB_ALLOW_NETWORK";

// ── Confidence mapping ───────────────────────────────────────────────────────

/**
 * Map a Beezulbub report's numeric confidence (0-1) to a council band.
 *
 * Floor rules (applied before the numeric band):
 *   - 0 candidates found → always "low" (fixture or live miss).
 *   - >= 3 unknowns      → floor to "low" (too many open questions).
 *
 * Band mapping (applied after floor checks):
 *   >= 0.7 → "high"
 *   >= 0.4 → "medium"
 *   <  0.4 → "low"
 */
export function mapBeezulbubConfidence(
  report: Pick<BeezulbubCapabilityReport, "confidence" | "candidateSources" | "unknowns">
): "low" | "medium" | "high" {
  // Floor: no candidates found.
  if (report.candidateSources.length === 0) return "low";
  // Floor: too many unknowns (high uncertainty even if score looks ok).
  if (report.unknowns.length >= 3) return "low";
  // Numeric band.
  const c = report.confidence;
  if (c >= 0.7) return "high";
  if (c >= 0.4) return "medium";
  return "low";
}

// ── Summary builder ──────────────────────────────────────────────────────────

/**
 * Build a concise council-facing summary from the report.
 *
 * - 0 candidates → honest "no candidates found — fixture scout" line.
 * - 1+ candidates → candidate count + top pick name and estimated value.
 */
export function buildBeezulbubSummary(
  report: Pick<BeezulbubCapabilityReport, "candidateSources" | "searchScope">
): string {
  const { candidateSources, searchScope } = report;
  if (candidateSources.length === 0) {
    return (
      `No candidates found for "${searchScope.target}" — fixture scout ` +
      `(mode: ${searchScope.mode}; live search disabled by default).`
    );
  }
  // Candidates are sorted by estimatedValue desc inside scoutCandidates.
  const top = candidateSources[0]!;
  const count = candidateSources.length;
  return (
    `Found ${count} candidate(s) for "${searchScope.target}". ` +
    `Top pick: ${top.name} (value: ${top.estimatedValue}/10, stale-risk: ${top.staleRisk}).`
  );
}

// ── Risk builder ─────────────────────────────────────────────────────────────

/**
 * Collect top risks from the report: doctrine, license, security, and unknowns.
 *
 * Capped at MAX_RISKS total to keep the council panel tidy.
 * Each item is prefixed with its category.
 */
export function buildBeezulbubRisks(
  report: Pick<
    BeezulbubCapabilityReport,
    "doctrineRisks" | "licenseNotes" | "securityNotes" | "unknowns"
  >
): string[] {
  const items: string[] = [];

  for (const d of report.doctrineRisks) {
    items.push(`Doctrine [${d.severity}]: ${d.description}`);
  }
  for (const l of report.licenseNotes) {
    if (l.risk !== "safe") {
      items.push(`License [${l.risk}]: ${l.source} — ${l.notes}`);
    }
  }
  for (const s of report.securityNotes) {
    items.push(`Security [${s.severity}]: ${s.description}`);
  }
  for (const u of report.unknowns) {
    items.push(`Unknown: ${u}`);
  }

  return items.slice(0, MAX_RISKS);
}

// ── Public entry ─────────────────────────────────────────────────────────────

/**
 * The Beezulbub "brain" for the P7 council.
 *
 * Satisfies `CouncilBrains.beezulbub: (goal: CouncilGoal) => Promise<BeezulbubCouncilBrainResult>`.
 *
 * - NEVER throws (all paths wrapped; errors → degraded sentinel).
 * - FIXTURE by default (zero network, zero cost, deterministic).
 * - LIVE mode requires BEEZULBUB_ALLOW_NETWORK=true in env (the authoritative gate in scout.ts).
 * - Honest confidence — floors to "low" on 0 candidates or high unknowns. Never launders up.
 * - degraded:true when zero candidates (fixture-only with no entry, or live miss).
 * - degraded:false when real candidates were found (live scouting with results).
 */
export async function beezulbubCouncilBrain(
  goal: CouncilGoal,
  env: Env = process.env
): Promise<BeezulbubCouncilBrainResult> {
  try {
    const allowNetwork =
      String(env[ALLOW_NETWORK_FLAG] ?? "").trim().toLowerCase() === "true";

    const spec = {
      // Use a stable specId derived from the goal (trimmed, lowercased).
      agentSpecId: `council-goal:${goal.goal.trim().toLowerCase().slice(0, 80)}`,
      targetCapability: goal.goal.trim(),
    };

    const report = await autoScoutForSpec(spec, {
      allowNetwork,
      limit: 5,
    });

    const summary = buildBeezulbubSummary(report);
    const confidence = mapBeezulbubConfidence(report);
    const risks = buildBeezulbubRisks(report);

    // degraded:true when no candidates found (fixture-only with no entry, or live miss).
    // degraded:false when real candidates were found.
    const degraded = report.candidateSources.length === 0;

    return { summary, confidence, risks, degraded };
  } catch {
    // Last-resort safety net — the adapter must never throw.
    return DEGRADED_RESULT;
  }
}
