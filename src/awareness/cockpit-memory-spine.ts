/**
 * src/awareness/cockpit-memory-spine.ts
 *
 * Step 2b — the PURE, Worker-safe read seam for the Executive Memory spine. Mirrors
 * cockpit-proposal-spine: it names the anon read RPC and coerces its rows into the
 * canonical `MemorySnapshot[]` the cockpit reasons over. No pg, no fetch, no clock —
 * so it is safe to import into the read-only Worker bundle (the live read in
 * cloudflare-live-read-models.ts uses these), and trivially unit-testable.
 *
 * Defensive by construction: anything malformed is dropped (never throws), so a
 * partially-bad row can never corrupt the memory the cockpit renders.
 */

import type { MemorySnapshot, MemoryMetric, DecisionRecord } from "./executive-memory.js";

/** The anon, read-only RPC the Worker calls (created by the 20260610 migration). */
export const COCKPIT_MEMORY_RPC = "get_cockpit_memory_snapshots";

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function asMetrics(v: unknown): MemoryMetric[] {
  if (!Array.isArray(v)) return [];
  const out: MemoryMetric[] = [];
  for (const m of v) {
    if (m && typeof m === "object") {
      const key = (m as Record<string, unknown>).key;
      const value = (m as Record<string, unknown>).value;
      if (typeof key === "string" && typeof value === "number") out.push({ key, value });
    }
  }
  return out;
}

function asDecisions(v: unknown): DecisionRecord[] {
  if (!Array.isArray(v)) return [];
  const out: DecisionRecord[] = [];
  for (const d of v) {
    if (!d || typeof d !== "object") continue;
    const r = d as Record<string, unknown>;
    if (
      typeof r.decision === "string" &&
      typeof r.domain === "string" &&
      typeof r.at === "string" &&
      typeof r.evidence === "string"
    ) {
      const rec: DecisionRecord = { decision: r.decision, domain: r.domain, at: r.at, evidence: r.evidence };
      if (typeof r.outcome === "string" || r.outcome === null) rec.outcome = r.outcome as string | null;
      out.push(rec);
    }
  }
  return out;
}

/** Coerce one stored snapshot object into a MemorySnapshot, or null when malformed. */
export function coerceMemorySnapshot(snap: unknown): MemorySnapshot | null {
  if (!snap || typeof snap !== "object") return null;
  const s = snap as Record<string, unknown>;
  if (typeof s.at !== "string") return null;
  const out: MemorySnapshot = {
    at: s.at,
    riskSubjects: asStringArray(s.riskSubjects),
    driftSubjects: asStringArray(s.driftSubjects),
    opportunitySubjects: asStringArray(s.opportunitySubjects),
    blindSpotSubjects: asStringArray(s.blindSpotSubjects),
    metrics: asMetrics(s.metrics),
  };
  const decisions = asDecisions(s.decisions);
  if (decisions.length) out.decisions = decisions;
  return out;
}

/**
 * Coerce the RPC result (rows of `{ day, captured_at, snapshot }`) into MemorySnapshot[].
 * Tolerates a row that IS the snapshot (no wrapper). Drops any malformed row.
 */
export function coerceCockpitMemoryRows(body: unknown): MemorySnapshot[] {
  const rows = Array.isArray(body) ? body : [];
  const out: MemorySnapshot[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const wrapped = (r as Record<string, unknown>).snapshot;
    const coerced = coerceMemorySnapshot(wrapped ?? r);
    if (coerced) out.push(coerced);
  }
  return out;
}
