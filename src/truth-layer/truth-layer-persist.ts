/**
 * src/truth-layer/truth-layer-persist.ts — flattens a TruthLayerReport into one append-only
 * snapshot record (cockpit_truth_snapshots), so the system keeps an honest audit trail of what
 * was true over time and the cockpit can survive a read-model outage with the last known truth.
 * PURE: no I/O — the caller persists the returned record.
 */

import type { TruthLayerReport } from "./truth-layer-api.js";
import { fleetHealthPercent } from "./truth-layer-api.js";
import type { FleetLiveness } from "../sentinel/sentinel-liveness.js";

export interface TruthSnapshot {
  capturedAt: string;
  ok: boolean;
  overall: FleetLiveness["overall"];
  version: string | null;
  healthPercent: number;
  up: number;
  stale: number;
  down: number;
  unknown: number;
  assessed: number;
}

export function toTruthSnapshot(report: TruthLayerReport): TruthSnapshot {
  const c = report.fleet.counts;
  return {
    capturedAt: report.computedAt,
    ok: report.ok,
    overall: report.fleet.overall,
    version: report.version,
    healthPercent: fleetHealthPercent(report.fleet),
    up: c.up,
    stale: c.stale,
    down: c.down,
    unknown: c.unknown,
    assessed: c.assessed,
  };
}
