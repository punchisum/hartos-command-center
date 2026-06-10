/**
 * src/wolverine/detectors/capability-risk.ts
 *
 * Wolverine detector — audits BEEZULBUB's capability scouts (the immune system watching capability
 * intelligence). A scout that recommends a copyleft/unknown-license or stale top candidate is an
 * absorption trap: absorbing it would drift HartOS from its license posture or pull in unmaintained
 * code. Advisory only (no fixRoute) — Wolverine flags; absorbing anything stays Hart-gated.
 *
 * Pure: operates on the host-gathered capabilityScouts summaries. Aggregated so a big scout history
 * doesn't produce a wall of noise.
 */

import type { WolverineFinding, WolverineInputs } from "../wolverine-types.js";

export const CAPABILITY_RISK_DETECTOR = "capability-risk";

function sample(xs: string[]): string {
  return xs.slice(0, 3).join(", ") + (xs.length > 3 ? ", …" : "");
}

export function detectCapabilityRisk(inputs: WolverineInputs): WolverineFinding[] {
  const scouts = inputs.capabilityScouts ?? [];
  if (scouts.length === 0) return [];

  const riskyLicense = scouts.filter((s) => s.topCandidate && s.riskyTopLicense);
  const staleTop = scouts.filter((s) => s.topCandidate && s.staleTop);
  const out: WolverineFinding[] = [];

  if (riskyLicense.length) {
    out.push({
      id: "capability-risk:license",
      category: "doctrine_drift",
      severity: "medium",
      title: `${riskyLicense.length} capability scout(s) recommend a copyleft/unknown-license top pick`,
      evidence:
        `Scouts whose top candidate carries a copyleft/unknown license: ` +
        `${sample(riskyLicense.map((s) => `${s.target}→${s.topCandidate} (${s.topLicense ?? "unknown"})`))}. ` +
        `Absorbing copyleft (GPL/AGPL/…) or unverified-license code would drift HartOS from its license posture.`,
      ownerAgent: "Beezulbub",
      recommendedFix: "Prefer a permissive (MIT/Apache/BSD) candidate, treat the risky one as REFERENCE-ONLY, or get explicit license sign-off before any digest/absorption.",
      blastRadius: "Capability absorption decisions — no code is copied without Hart's approval.",
      rollbackPath: "n/a — advisory; nothing absorbed.",
      approvalRequired: false,
      confidence: "high",
      freshness: "scout summary, as of run",
      source: CAPABILITY_RISK_DETECTOR,
    });
  }

  if (staleTop.length) {
    out.push({
      id: "capability-risk:stale-top",
      category: "improvement",
      severity: "low",
      title: `${staleTop.length} capability scout(s) lead with a stale (unmaintained) top pick`,
      evidence:
        `Scouts whose top candidate is high stale-risk: ${sample(staleTop.map((s) => `${s.target}→${s.topCandidate}`))}. ` +
        `Unmaintained code carries latent security/bug risk and absorption cost.`,
      ownerAgent: "Beezulbub",
      recommendedFix: "Re-scout for a maintained alternative, or accept the staleness explicitly with a maintenance plan.",
      blastRadius: "Capability absorption decisions.",
      rollbackPath: "n/a — advisory.",
      approvalRequired: false,
      confidence: "medium",
      freshness: "scout summary, as of run",
      source: CAPABILITY_RISK_DETECTOR,
    });
  }

  return out;
}
