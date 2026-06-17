/**
 * src/sentinel/sentinel-liveness.ts — SENTINEL, the fleet heartbeat agent (PURE core).
 *
 * Sentinel answers ONE question continuously: "is every agent in the fleet alive?" It folds
 * the meta-agent registry (who SHOULD be running) with host-gathered heartbeats (the latest
 * evidence each agent actually produced — report artifacts, read-model rows, pulse runs, the
 * answering Worker itself) into a per-agent liveness verdict + a fleet rollup.
 *
 * Doctrine: automatic eyes, gated hands. Sentinel DETECTS down/stale agents; it never restarts,
 * redeploys, or mutates anything. Its verdicts feed the Wolverine agent-liveness detector
 * (findings → FixProposals → Hart) and the cockpit /api/liveness surface. Honest staleness:
 * an agent with no gathered evidence is "unknown", never assumed up.
 *
 * PURE: no I/O, no clock (now injected), no env. Same inputs ⇒ same verdicts.
 */

import type { MetaAgent, MetaAgentRegistry } from "../agents/meta-agent-registry.js";

/** The latest evidence the host could find that an agent actually ran/produced output. */
export interface AgentHeartbeat {
  agentId: string;
  /** ISO timestamp of the newest evidence, or null when the source exists but is empty. */
  lastEvidenceAt: string | null;
  /** Where the evidence came from (artifact dir, read-model, pulse run, worker) — honesty. */
  evidenceSource: string;
  /**
   * An upstream freshness system (e.g. read-model sourceDiagnostics) already judged this
   * source stale. Sentinel carries that verdict through rather than fabricating a timestamp.
   */
  upstreamStale?: boolean;
  /**
   * The evidence came from a HOST-BOUND source (a local artifact/file that goes dark the moment
   * Hart's machine is off), as opposed to an always-on cloud source (the answering Worker, a
   * Supabase read-model). Set by the edge that read it. Absent ⇒ treated as cloud (false).
   */
  hostBound?: boolean;
}

export type LivenessState = "up" | "stale" | "down" | "unknown";

export interface LivenessVerdict {
  agentId: string;
  displayName: string;
  state: LivenessState;
  lastEvidenceAt: string | null;
  /** Hours since last evidence (rounded to 0.1h), or null when unknown. */
  ageHours: number | null;
  evidenceSource: string | null;
  reason: string;
  /** Catalog status carried through so the cockpit can show expectation vs reality. */
  catalogStatus: MetaAgent["status"];
  /** Carried from the heartbeat: was this agent's evidence host-bound? (default false) */
  hostBound?: boolean;
  /**
   * The host-offline gate concluded the whole machine was simply off, so this agent's silence is
   * EXPECTED, not organic. Downstream (Wolverine bridge/detector, the alert policy) stay quiet on it.
   */
  offlineExpected?: boolean;
}

/** One calm rollup raised in place of N "down — investigate" findings when the host was simply off. */
export interface HostOfflineNote {
  /** ISO of the freshest host-bound evidence (when the host was last demonstrably on), or null. */
  since: string | null;
  /** Hours since `since` (rounded 0.1h), or null when no host-bound evidence parsed. */
  ageHours: number | null;
  /** Display names of the host-bound agents whose silence is treated as expected. */
  agents: string[];
  reason: string;
}

export interface FleetLiveness {
  generatedAt: string;
  verdicts: LivenessVerdict[];
  counts: { up: number; stale: number; down: number; unknown: number; assessed: number };
  /** GREEN = nothing down/stale; AMBER = something stale/unknown; RED = something down. */
  overall: "GREEN" | "AMBER" | "RED";
  overallReason: string;
  /** Set when the host-offline gate fired; null otherwise. */
  hostOffline?: HostOfflineNote | null;
}

export interface LivenessThresholds {
  /** Evidence older than this many hours ⇒ stale (default 26h: a daily cadence + grace). */
  staleHours?: number;
  /** Evidence older than this many hours ⇒ down (default 72h). */
  downHours?: number;
}

export const DEFAULT_STALE_HOURS = 26;
export const DEFAULT_DOWN_HOURS = 72;

/** Catalog nodes Sentinel does not assess: the human, and Sentinel itself. */
function assessable(agent: MetaAgent): boolean {
  return agent.category !== "human" && agent.id !== "sentinel";
}

/**
 * Fold registry + heartbeats into per-agent verdicts and the fleet rollup. PURE + deterministic;
 * verdicts are ordered worst-first (down → stale → unknown → up), id ascending within a state.
 */
export function assessFleetLiveness(
  registry: MetaAgentRegistry,
  heartbeats: AgentHeartbeat[],
  now: string,
  thresholds: LivenessThresholds = {},
): FleetLiveness {
  const staleHours = thresholds.staleHours ?? DEFAULT_STALE_HOURS;
  const downHours = thresholds.downHours ?? DEFAULT_DOWN_HOURS;
  const nowMs = Date.parse(now);
  const byAgent = new Map(heartbeats.map((h) => [h.agentId, h]));

  const verdicts: LivenessVerdict[] = registry.agents.filter(assessable).map((agent) => {
    const hb = byAgent.get(agent.id);
    if (hb?.upstreamStale) {
      const evidenceMs = hb.lastEvidenceAt === null ? NaN : Date.parse(hb.lastEvidenceAt);
      const ageHours =
        Number.isFinite(evidenceMs) && Number.isFinite(nowMs)
          ? Math.round(((nowMs - evidenceMs) / 36e5) * 10) / 10
          : null;
      return {
        agentId: agent.id,
        displayName: agent.displayName,
        state: "stale",
        lastEvidenceAt: hb.lastEvidenceAt,
        ageHours,
        evidenceSource: hb.evidenceSource,
        reason: `Upstream freshness diagnostics flagged ${hb.evidenceSource} stale — carried through, not re-derived.`,
        catalogStatus: agent.status,
        hostBound: !!hb?.hostBound,
      };
    }
    if (!hb || hb.lastEvidenceAt === null) {
      return {
        agentId: agent.id,
        displayName: agent.displayName,
        state: "unknown",
        lastEvidenceAt: null,
        ageHours: null,
        evidenceSource: hb?.evidenceSource ?? null,
        reason: hb
          ? `Evidence source "${hb.evidenceSource}" exists but holds no runs — never assumed up.`
          : "No evidence source gathered for this agent — unknown is honest, not a failure.",
        catalogStatus: agent.status,
        hostBound: !!hb?.hostBound,
      };
    }
    const evidenceMs = Date.parse(hb.lastEvidenceAt);
    if (!Number.isFinite(evidenceMs) || !Number.isFinite(nowMs)) {
      return {
        agentId: agent.id,
        displayName: agent.displayName,
        state: "unknown",
        lastEvidenceAt: hb.lastEvidenceAt,
        ageHours: null,
        evidenceSource: hb.evidenceSource,
        reason: "Evidence timestamp unparseable — refusing to guess.",
        catalogStatus: agent.status,
        hostBound: !!hb?.hostBound,
      };
    }
    const ageHours = Math.round(((nowMs - evidenceMs) / 36e5) * 10) / 10;
    const state: LivenessState = ageHours <= staleHours ? "up" : ageHours <= downHours ? "stale" : "down";
    const reason =
      state === "up"
        ? `Fresh evidence ${ageHours}h ago via ${hb.evidenceSource}.`
        : state === "stale"
          ? `Last evidence ${ageHours}h ago via ${hb.evidenceSource} — older than the ${staleHours}h freshness window.`
          : `Last evidence ${ageHours}h ago via ${hb.evidenceSource} — silent past the ${downHours}h down threshold.`;
    return {
      agentId: agent.id,
      displayName: agent.displayName,
      state,
      lastEvidenceAt: hb.lastEvidenceAt,
      ageHours,
      evidenceSource: hb.evidenceSource,
      reason,
      catalogStatus: agent.status,
      hostBound: !!hb?.hostBound,
    };
  });

  const rank: Record<LivenessState, number> = { down: 0, stale: 1, unknown: 2, up: 3 };
  verdicts.sort((a, b) => rank[a.state] - rank[b.state] || a.agentId.localeCompare(b.agentId));

  // ── Host-offline gate ───────────────────────────────────────────────────────
  // If the freshest evidence among HOST-BOUND agents is itself stale (or there is none), the whole
  // machine was simply off — those agents' shared silence is EXPECTED, not organic. Flag them so the
  // Wolverine bridge/detector + alert policy stay quiet and surface ONE calm note instead of N. If
  // even one host-bound agent is fresh, the host was on ⇒ no gate ⇒ other silences stay organic.
  let hostOffline: HostOfflineNote | null = null;
  const hostBoundVerdicts = verdicts.filter((v) => v.hostBound);
  if (hostBoundVerdicts.length > 0) {
    const hostTimes = hostBoundVerdicts
      .map((v) => (v.lastEvidenceAt === null ? NaN : Date.parse(v.lastEvidenceAt)))
      .filter((ms) => Number.isFinite(ms));
    const freshestMs = hostTimes.length > 0 ? Math.max(...hostTimes) : null;
    const hostAgeHours =
      freshestMs !== null && Number.isFinite(nowMs)
        ? Math.round(((nowMs - freshestMs) / 36e5) * 10) / 10
        : null;
    const hostOff = freshestMs === null || hostAgeHours === null || hostAgeHours > staleHours;
    if (hostOff) {
      const quiet = hostBoundVerdicts.filter((v) => v.state === "down" || v.state === "stale");
      for (const v of quiet) v.offlineExpected = true;
      const since = freshestMs === null ? null : new Date(freshestMs).toISOString();
      hostOffline = {
        since,
        ageHours: hostAgeHours,
        agents: quiet.map((v) => v.displayName),
        reason:
          since === null
            ? "No host-bound agent has produced any evidence — the host appears offline; shared silence is expected, not a failure."
            : `Freshest host-bound evidence is ${hostAgeHours}h old (> ${staleHours}h) — the host appears to have been offline since then; shared silence is expected, not a failure.`,
      };
    }
  }

  const counts = {
    up: verdicts.filter((v) => v.state === "up").length,
    stale: verdicts.filter((v) => v.state === "stale").length,
    down: verdicts.filter((v) => v.state === "down").length,
    unknown: verdicts.filter((v) => v.state === "unknown").length,
    assessed: verdicts.length,
  };

  const overall = counts.down > 0 ? "RED" : counts.stale > 0 || counts.unknown > 0 ? "AMBER" : "GREEN";
  const overallReason =
    overall === "RED"
      ? `${counts.down} agent(s) down — fleet is NOT fully operational.`
      : overall === "AMBER"
        ? `${counts.stale} stale + ${counts.unknown} unknown agent(s) — verify before trusting "all up".`
        : `All ${counts.assessed} assessed agents show fresh evidence.`;

  return { generatedAt: now, verdicts, counts, overall, overallReason, hostOffline };
}

/**
 * Worker-safe heartbeats from the read-model diagnostics the hosted cockpit honestly has: itself
 * (it is answering ⇒ fresh) + the fitness/ops read-models (stale carried through, else snapshot).
 * Agents with no Worker-visible evidence stay absent ⇒ the core reports them "unknown". PURE.
 */
export function heartbeatsFromReadModels(
  rm: { staleSources: string[]; enabledSources: string[] },
  nowIso: string,
  snapshotAt: string | null,
): AgentHeartbeat[] {
  const heartbeats: AgentHeartbeat[] = [
    { agentId: "cockpit", lastEvidenceAt: nowIso, evidenceSource: "the answering Worker" },
  ];
  for (const domain of ["fitness", "ops"] as const) {
    if (rm.staleSources.includes(domain)) {
      heartbeats.push({
        agentId: domain,
        lastEvidenceAt: snapshotAt,
        evidenceSource: `${domain} read-model diagnostics`,
        upstreamStale: true,
      });
    } else if (rm.enabledSources.includes(domain)) {
      heartbeats.push({
        agentId: domain,
        lastEvidenceAt: snapshotAt,
        evidenceSource: `${domain} read-model snapshot`,
      });
    }
  }
  return heartbeats;
}

/** One-screen, honest text rollup (for the CLI). */
export function describeFleetLiveness(fleet: FleetLiveness): string {
  const lines = [
    `Sentinel — fleet liveness ${fleet.overall} (${fleet.overallReason})`,
    `up ${fleet.counts.up} · stale ${fleet.counts.stale} · down ${fleet.counts.down} · unknown ${fleet.counts.unknown} (of ${fleet.counts.assessed})`,
  ];
  if (fleet.hostOffline) {
    lines.push(
      `  ⚐ Host appears OFFLINE — ${fleet.hostOffline.agents.length} agent(s) quiet (expected, no action): ${fleet.hostOffline.reason}`,
    );
  }
  for (const v of fleet.verdicts) {
    lines.push(`  [${v.state.toUpperCase().padEnd(7)}] ${v.displayName} — ${v.reason}`);
  }
  return lines.join("\n");
}
