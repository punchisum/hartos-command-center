/**
 * src/wolverine/wolverine-audit.ts
 *
 * Wolverine v1 — the pure aggregator. Runs the detectors over the supplied inputs, ranks the
 * findings worst-first, and computes an honest GREEN/AMBER/RED system verdict (clamped to the
 * worst real finding — never greener than the evidence). Produces the top-5 risks + the full
 * ranked repair queue. No I/O; fully deterministic and unit-testable.
 *
 * Verdict rule (conservative): any critical OR ≥2 high ⇒ RED; any high OR ≥3 medium ⇒ AMBER;
 * else GREEN. An empty finding set is GREEN ("nothing detected" — honestly, not "all healthy").
 */

import {
  SEVERITY_RANK,
  type SystemVerdict,
  type WolverineDetector,
  type WolverineFinding,
  type WolverineInputs,
  type WolverineReport,
  type WolverineSeverity,
} from "./wolverine-types.js";
import { detectUnsafeFlags } from "./detectors/unsafe-flags.js";
import { detectGitHygiene } from "./detectors/git-hygiene.js";

/** The default v1 detector set. Add detectors here as increments land. */
export const DEFAULT_DETECTORS: WolverineDetector[] = [detectUnsafeFlags, detectGitHygiene];

function rankFindings(findings: WolverineFinding[]): WolverineFinding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.id.localeCompare(b.id),
  );
}

function countBySeverity(findings: WolverineFinding[]): Record<WolverineSeverity, number> {
  const by: Record<WolverineSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) by[f.severity] += 1;
  return by;
}

function computeVerdict(by: Record<WolverineSeverity, number>): { verdict: SystemVerdict; reason: string } {
  if (by.critical > 0) return { verdict: "RED", reason: `${by.critical} critical issue(s) — act now.` };
  if (by.high >= 2) return { verdict: "RED", reason: `${by.high} high-severity issues — system needs attention now.` };
  if (by.high === 1) return { verdict: "AMBER", reason: "1 high-severity issue — address soon." };
  if (by.medium >= 3) return { verdict: "AMBER", reason: `${by.medium} medium issues accumulating.` };
  const total = by.high + by.medium + by.low;
  if (total === 0) return { verdict: "GREEN", reason: "No issues detected by the active detectors." };
  return { verdict: "GREEN", reason: `${total} minor issue(s) only — no high-severity risk.` };
}

export interface WolverineAuditOptions {
  /** Override the detector set (tests inject their own). Defaults to DEFAULT_DETECTORS. */
  detectors?: WolverineDetector[];
}

/**
 * Run the audit. Each detector is isolated: if one throws, its failure becomes a low-severity
 * finding rather than crashing the audit (the immune system must not be brittle).
 */
export function wolverineAudit(inputs: WolverineInputs, opts: WolverineAuditOptions = {}): WolverineReport {
  const detectors = opts.detectors ?? DEFAULT_DETECTORS;
  const findings: WolverineFinding[] = [];
  for (const detector of detectors) {
    try {
      findings.push(...detector(inputs));
    } catch (err) {
      findings.push({
        id: `detector-error:${detector.name || "anon"}`,
        category: "broken_wiring",
        severity: "low",
        title: `A Wolverine detector failed to run`,
        evidence: `Detector "${detector.name || "anon"}" threw: ${err instanceof Error ? err.message : String(err)}.`,
        recommendedFix: "Fix or guard the detector; an audit gap is itself a risk.",
        blastRadius: "Audit coverage only.",
        rollbackPath: "n/a",
        approvalRequired: false,
        confidence: "high",
        freshness: "as of run",
        source: "wolverine-audit",
      });
    }
  }

  const ranked = rankFindings(findings);
  const bySeverity = countBySeverity(ranked);
  const { verdict, reason } = computeVerdict(bySeverity);

  return {
    generatedAt: inputs.now,
    verdict,
    verdictReason: reason,
    findingCount: ranked.length,
    bySeverity,
    topRisks: ranked.slice(0, 5),
    repairQueue: ranked,
    note:
      ranked.length === 0
        ? "Wolverine found nothing with the active detectors — coverage is still partial (v1)."
        : `Wolverine surfaced ${ranked.length} finding(s); ${bySeverity.high + bySeverity.critical} need attention. Repairs are approval-gated — Wolverine proposes, it never acts.`,
  };
}
