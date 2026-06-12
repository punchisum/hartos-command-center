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
 * The share of ASSESSED capabilities with fresh evidence (0-100), derived from real liveness
 * counts — not asserted catalog status. Honestly 0 (never a flattering 100) when nothing could
 * be assessed. This is the truth-layer basis for the v5 cockpit's fleet-health figure, replacing
 * the count of registry entries hand-marked "live".
 */
export function fleetHealthPercent(fleet: FleetLiveness): number {
  const { up, assessed } = fleet.counts;
  if (assessed <= 0) return 0;
  return Math.round((up / assessed) * 100);
}
