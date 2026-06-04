/**
 * src/cockpit/sources/freshness.ts
 *
 * Phase 13E — shared freshness + confidence model. Deterministic, pure. `now`
 * is always injected (never read from the clock here) so results are testable.
 */

import type { Freshness, SourceConfidence, SourceType } from "./source-types.js";

export interface FreshnessThresholds {
  /** Data at or under this age is "fresh". */
  freshMaxAgeMs: number;
}

export const DEFAULT_FRESHNESS: FreshnessThresholds = {
  freshMaxAgeMs: 24 * 60 * 60 * 1000, // 24h
};

/**
 * fresh  → has a timestamp within the window
 * stale  → has a timestamp older than the window
 * unknown→ no parseable timestamp
 */
export function computeFreshness(
  lastUpdated: string | null,
  now: string,
  thresholds: FreshnessThresholds = DEFAULT_FRESHNESS
): Freshness {
  if (!lastUpdated) return "unknown";
  const t = Date.parse(lastUpdated);
  const n = Date.parse(now);
  if (Number.isNaN(t) || Number.isNaN(n)) return "unknown";
  if (t > n) return "fresh"; // future-stamped → treat as fresh, not stale
  return n - t <= thresholds.freshMaxAgeMs ? "fresh" : "stale";
}

/** Confidence is a function of where the value came from AND how fresh it is. */
export function confidenceFor(sourceType: SourceType, freshness: Freshness): SourceConfidence {
  const live = sourceType === "supabase_readonly" || sourceType === "read_model";
  if (live && freshness === "fresh") return "high";
  if (live && freshness === "stale") return "medium";
  if (sourceType === "local_report" || sourceType === "capability_registry" || sourceType === "runtime_modules") {
    return freshness === "fresh" ? "medium" : "low";
  }
  // handover / derived / unknown
  return "low";
}

/** Worst (lowest) freshness across a set — used to summarize a whole source. */
export function worstFreshness(values: Freshness[]): Freshness {
  if (values.length === 0) return "unknown";
  if (values.includes("stale")) return "stale";
  if (values.every((v) => v === "fresh")) return "fresh";
  return "unknown";
}

/** Lowest confidence across a set. */
export function lowestConfidence(values: SourceConfidence[]): SourceConfidence {
  if (values.includes("low") || values.length === 0) return "low";
  if (values.includes("medium")) return "medium";
  return "high";
}
