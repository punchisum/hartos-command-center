/**
 * src/cockpit/sources/source-types.ts
 *
 * Phase 13A — read-only source contracts. A "source" is a read-only data
 * boundary the cockpit can pull from (Supabase read-model, local report,
 * handover file, capability registry, runtime modules, or a pure derivation).
 *
 * Every source result is self-describing: status, freshness, confidence, the
 * exact missing reason + next setup step when unavailable, and safe diagnostics
 * that NEVER contain secret values. No source here exposes a mutation method.
 */

export type SourceType =
  | "supabase_readonly"
  | "read_model"
  | "local_report"
  | "handover"
  | "capability_registry"
  | "runtime_modules"
  | "derived"
  | "none";

export type SourceStatus = "available" | "partial" | "unavailable";

/** Phase 13E shared freshness model. */
export type Freshness = "fresh" | "stale" | "unknown";

export type SourceConfidence = "high" | "medium" | "low";

/** Safe diagnostics — names/paths/notes only, NEVER secret values. */
export interface SourceDiagnostics {
  /** Boundaries/paths probed (names only). */
  checked: string[];
  /** Human-readable notes; no secrets. */
  notes: string[];
}

/** A single resolved value with full provenance + freshness. */
export interface SourceValue {
  value: string;
  source: string;
  sourceType: SourceType;
  lastUpdated: string | null;
  freshness: Freshness;
  confidence: SourceConfidence;
}

/** The result of resolving one domain source (fitness/ops/factory/…). */
export interface SourceResult {
  name: string;
  /** Winning/primary source type that produced most values. */
  sourceType: SourceType;
  status: SourceStatus;
  lastUpdated: string | null;
  freshness: Freshness;
  confidence: SourceConfidence;
  /** Why the source is unavailable/partial (no secrets), else null. */
  missingReason: string | null;
  /** Exact next setup step to make the source available, else null. */
  setupStep: string | null;
  diagnostics: SourceDiagnostics;
  /** Extracted values keyed by field id. */
  values: Record<string, SourceValue>;
}

export function emptyDiagnostics(): SourceDiagnostics {
  return { checked: [], notes: [] };
}

/** Look up a resolved value, or undefined. */
export function getValue(result: SourceResult, key: string): SourceValue | undefined {
  return result.values[key];
}
