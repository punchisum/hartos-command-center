/**
 * src/cockpit/sources/layered.ts
 *
 * Phase 13 — priority resolution across read-only layers. Each layer is already
 * field-keyed; the first layer that has a value for a field wins, carrying that
 * layer's freshness + confidence. This encodes the data priority:
 *   live read-model  →  local report  →  handover  →  (unavailable)
 */

import type { Freshness, SourceConfidence, SourceType, SourceValue } from "./source-types.js";
import { computeFreshness, confidenceFor, lowestConfidence, worstFreshness } from "./freshness.js";

export interface SourceLayer {
  sourceType: SourceType;
  source: string;
  lastUpdated: string | null;
  /** Already mapped to FIELD keys (not raw provider keys). */
  values: Record<string, string | undefined>;
}

export function layeredResolve(
  keys: string[],
  layers: SourceLayer[],
  now: string
): Record<string, SourceValue> {
  const out: Record<string, SourceValue> = {};
  for (const key of keys) {
    for (const layer of layers) {
      const v = layer.values[key];
      if (v != null && v !== "") {
        const freshness = computeFreshness(layer.lastUpdated, now);
        out[key] = {
          value: v,
          source: layer.source,
          sourceType: layer.sourceType,
          lastUpdated: layer.lastUpdated,
          freshness,
          confidence: confidenceFor(layer.sourceType, freshness),
        };
        break;
      }
    }
  }
  return out;
}

/** Summarize the winning source type / freshness / confidence across values. */
export function summarizeValues(values: Record<string, SourceValue>): {
  sourceType: SourceType;
  freshness: Freshness;
  confidence: SourceConfidence;
  lastUpdated: string | null;
} {
  const list = Object.values(values);
  if (list.length === 0) return { sourceType: "none", freshness: "unknown", confidence: "low", lastUpdated: null };
  // Primary source type = the most common one.
  const counts: Record<string, number> = {};
  for (const v of list) counts[v.sourceType] = (counts[v.sourceType] ?? 0) + 1;
  const sourceType = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "derived") as SourceType;
  const freshness = worstFreshness(list.map((v) => v.freshness));
  const confidence = lowestConfidence(list.map((v) => v.confidence));
  const lastUpdated = list.map((v) => v.lastUpdated).filter((x): x is string => !!x).sort().reverse()[0] ?? null;
  return { sourceType, freshness, confidence, lastUpdated };
}
