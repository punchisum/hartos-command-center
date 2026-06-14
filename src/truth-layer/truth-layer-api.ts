/**
 * src/truth-layer/truth-layer-api.ts — the single source of truth payload (PURE core).
 *
 * Composes an already-assessed FleetLiveness with deploy metadata (which commit is live, when
 * it was built, which gates are armed) into the report GET /health returns. Its whole reason to
 * exist: `ok` is COMPUTED from real fleet evidence, never the hardcoded `ok: true` the audit
 * caught. The cockpit and memory READ this; they never assert their own status.
 *
 * PURE: no I/O, no clock (now injected), no env. Armed flags are presence-only — never values.
 */

import { assessFleetLiveness, type FleetLiveness } from "../sentinel/sentinel-liveness.js";
import { gatherHeartbeats } from "../sentinel/heartbeat-gatherer.js";
import type { MetaAgentRegistry } from "../agents/meta-agent-registry.js";

/** A feature-gate flag, reported by PRESENCE only — its value is never exposed. */
export interface ArmedFlag {
  name: string;
  present: boolean;
}

export interface TruthLayerMeta {
  now: string;
  /** Deployed commit SHA (BUILD_SHA), or null when not injected. */
  version: string | null;
  /** Deploy build time (BUILD_TIME), or null. */
  builtAt: string | null;
  armedFlags: ArmedFlag[];
}

export interface TruthLayerReport {
  ok: boolean;
  computedAt: string;
  version: string | null;
  builtAt: string | null;
  fleet: FleetLiveness;
  armedFlags: ArmedFlag[];
}

export function computeFleetVerdict(fleet: FleetLiveness, meta: TruthLayerMeta): TruthLayerReport {
  // ok is derived from real fleet evidence: not ok the moment any capability is hard-down.
  return {
    ok: fleet.overall !== "RED",
    computedAt: meta.now,
    version: meta.version,
    builtAt: meta.builtAt,
    fleet,
    armedFlags: meta.armedFlags,
  };
}

/**
 * End-to-end truth report from the inputs a Worker route honestly has: the registry (who should
 * run), the read-model diagnostics (enabled/stale sources), the snapshot time, `now`, and deploy
 * metadata. Composes the sanitizing gatherer → liveness assessor → verdict. PURE.
 */
export function assembleTruthReport(
  registry: MetaAgentRegistry,
  readModel: { enabledSources: string[]; staleSources: string[] },
  snapshotAt: string | null,
  now: string,
  meta: { version: string | null; builtAt: string | null; armedFlags: ArmedFlag[] },
): TruthLayerReport {
  const heartbeats = gatherHeartbeats({
    nowIso: now,
    readModel: {
      enabledSources: readModel.enabledSources,
      staleSources: readModel.staleSources,
      snapshotAt,
    },
  });
  const fleet = assessFleetLiveness(registry, heartbeats, now);
  return computeFleetVerdict(fleet, { now, version: meta.version, builtAt: meta.builtAt, armedFlags: meta.armedFlags });
}

/**
 * Composite fleet-health figure (0-100) = agent health + data freshness, per Hart's definition.
 * Each assessed capability contributes a weight:
 *   - "up"      (fresh evidence)               → 1.0  full health
 *   - "unknown" (registered capability the Worker simply can't see — healthy in principle, no
 *               live telemetry) → 0.7  mild STALENESS penalty, NOT treated as down. Most of the
 *               fleet reports back to the daemon, not the public Worker, so "unknown" dominates
 *               a Worker-side read; counting it as 0 made the figure read a misleading ~19%.
 *   - "stale"   (had evidence, now aged out)   → 0.35 degraded
 *   - "down"/missing                            → 0.0  none
 * Honestly 0 (never a flattering 100) when nothing could be assessed. This is the truth-layer
 * basis for the v5 cockpit's fleet-health figure.
 */
export const FLEET_HEALTH_WEIGHTS = { up: 1.0, unknown: 0.7, stale: 0.35, down: 0.0 } as const;

export function fleetHealthPercent(fleet: FleetLiveness): number {
  const { up, stale, down, unknown, assessed } = fleet.counts;
  if (assessed <= 0) return 0;
  const score =
    up * FLEET_HEALTH_WEIGHTS.up +
    unknown * FLEET_HEALTH_WEIGHTS.unknown +
    stale * FLEET_HEALTH_WEIGHTS.stale +
    down * FLEET_HEALTH_WEIGHTS.down;
  return Math.round((score / assessed) * 100);
}
