/**
 * src/beezulbub/scout-summary.ts — the compact CapabilityScoutSummary + (pure) helpers.
 *
 * A shared, Worker-safe projection of a Beezulbub scout that the immune system (Wolverine) and the
 * forecaster (Prophet) can both reason over — without depending on Beezulbub's internals. It also
 * round-trips a capability_dossier note BODY back into a summary, so a host can read filed scouts
 * from the vault and feed them to Wolverine/Prophet. Pure: no fs / clock / network.
 */

import type { BeezulbubScoutResult } from "./types.js";

export interface CapabilityScoutSummary {
  target: string;
  mode: "fixture" | "live" | "manual";
  candidateCount: number;
  topCandidate: string | null;
  topLicense: string | null;
  topStaleRisk: "low" | "medium" | "high" | null;
  /** Top/recommended candidate carries a copyleft/unknown license → an absorption risk. */
  riskyTopLicense: boolean;
  /** Top candidate is stale (high stale-risk). */
  staleTop: boolean;
}

// Copyleft / non-permissive / unknown licenses are absorption risks for HartOS (it ships closed).
// MIT / Apache / BSD / ISC are permissive and NOT flagged.
const RISKY_LICENSE = /GPL|MPL|EUPL|OSL|SSPL|CC-?BY-?NC|CDDL|EPL|custom|proprietary|unknown/i;

export function isRiskyLicense(license: string | null | undefined): boolean {
  if (!license || license.trim().length === 0) return true; // unknown ⇒ treat as risky
  return RISKY_LICENSE.test(license);
}

export function summarizeScout(result: BeezulbubScoutResult): CapabilityScoutSummary {
  const ranked = [...result.candidates].sort((a, b) => b.estimatedValue - a.estimatedValue);
  const top = ranked[0];
  const topLicense = top?.licenseGuess ?? null;
  return {
    target: result.target,
    mode: result.mode,
    candidateCount: ranked.length,
    topCandidate: top?.name ?? null,
    topLicense,
    topStaleRisk: top?.staleRisk ?? null,
    riskyTopLicense: top ? isRiskyLicense(topLicense) : false,
    staleTop: top?.staleRisk === "high",
  };
}

/**
 * Parse a capability_dossier note BODY back into a summary (defensive). Returns null when the body
 * isn't a capability scout. Lets a host read filed scouts from the vault for Wolverine/Prophet.
 */
export function parseCapabilityScoutNote(body: string): CapabilityScoutSummary | null {
  const target = body.match(/^#\s*Capability Scout\s*[—-]\s*(.+)$/m)?.[1]?.trim();
  if (!target) return null;
  const modeRaw = (body.match(/\*\*Mode:\s*(LIVE|FIXTURE|MANUAL)\*\*/i)?.[1] ?? "manual").toLowerCase();
  const mode = (modeRaw === "live" || modeRaw === "fixture" ? modeRaw : "manual") as CapabilityScoutSummary["mode"];
  const candidateCount = Number(body.match(/##\s*Candidates\s*\((\d+)/)?.[1] ?? 0);
  const topCandidate = body.match(/^###\s*1\.\s*(.+?)\s*[—-]\s*\d/m)?.[1]?.trim() ?? null;
  // First "- license: X · stale-risk: Y" after the top candidate line.
  const lic = body.match(/-\s*license:\s*(.+?)\s*·\s*stale-risk:\s*(\w+)/i);
  const topLicense = lic?.[1]?.trim() ?? null;
  const staleRaw = lic?.[2]?.toLowerCase();
  const topStaleRisk = (staleRaw === "low" || staleRaw === "medium" || staleRaw === "high" ? staleRaw : null) as CapabilityScoutSummary["topStaleRisk"];
  return {
    target,
    mode,
    candidateCount,
    topCandidate,
    topLicense,
    topStaleRisk,
    riskyTopLicense: topCandidate ? isRiskyLicense(topLicense) : false,
    staleTop: topStaleRisk === "high",
  };
}
