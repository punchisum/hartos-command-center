/**
 * src/sentinel/sentinel-heartbeat.ts — the PURE heartbeat alert policy (Worker-safe).
 *
 * The Cloudflare cron (scheduled handler) computes a FleetLiveness each tick; this module decides
 * whether that warrants an alert and shapes the (redacted, fact-only) alert payload. Detect-only:
 * it NEVER restarts/redeploys an agent — a down agent surfaces here and becomes a Wolverine
 * FixProposal for Hart. Pure: no I/O, no clock.
 *
 * Alert policy: fire only on DOWN or STALE (a real freshness failure). "unknown" is NOT alerted —
 * the hosted Worker has no evidence for most agents, and alerting on that every tick is noise, not
 * signal (the local `sentinel:status` cron covers full-fleet artifact evidence).
 */

import type { FleetLiveness } from "./sentinel-liveness.js";

export interface HeartbeatAlert {
  text: string;
  overall: FleetLiveness["overall"];
  down: number;
  stale: number;
  /** The flagged agents, "Name (state, Nh)" — facts only, no secrets. */
  agents: string[];
  at: string;
}

/** Fire only on a REAL freshness failure (down/stale) that is NOT a known host-offline silence. */
export function heartbeatShouldAlert(fleet: FleetLiveness): boolean {
  return fleet.verdicts.some((v) => (v.state === "down" || v.state === "stale") && !v.offlineExpected);
}

/** Shape the fact-only alert payload from the liveness rollup. */
export function buildHeartbeatAlert(fleet: FleetLiveness): HeartbeatAlert {
  const flagged = fleet.verdicts.filter((v) => v.state === "down" || v.state === "stale");
  return {
    text: `Sentinel heartbeat ${fleet.overall}: ${fleet.overallReason}`,
    overall: fleet.overall,
    down: fleet.counts.down,
    stale: fleet.counts.stale,
    agents: flagged.map((v) => `${v.displayName} (${v.state}, ${v.ageHours ?? "?"}h)`),
    at: fleet.generatedAt,
  };
}

/** One structured log line for Worker observability (wrangler tail / CF dashboard). */
export function heartbeatLogLine(fleet: FleetLiveness): string {
  const c = fleet.counts;
  const offline = fleet.hostOffline
    ? ` · host offline since ${fleet.hostOffline.since ?? "unknown"} (${fleet.hostOffline.agents.length} agent(s) quiet — expected)`
    : "";
  return `[sentinel-heartbeat] ${fleet.overall} — up ${c.up} stale ${c.stale} down ${c.down} unknown ${c.unknown} (of ${c.assessed}) · ${fleet.overallReason}${offline}`;
}
