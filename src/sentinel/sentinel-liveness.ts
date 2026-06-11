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
}

export interface FleetLiveness {
  generatedAt: string;
  verdicts: LivenessVerdict[];
  counts: { up: number; stale: number; down: number; unknown: number; assessed: number };
  /** GREEN = nothing down/stale; AMBER = something stale/unknown; RED = something down. */
  overall: "GREEN" | "AMBER" | "RED";
  overallReason: string;
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
    };
  });

  const rank: Record<LivenessState, number> = { down: 0, stale: 1, unknown: 2, up: 3 };
  verdicts.sort((a, b) => rank[a.state] - rank[b.state] || a.agentId.localeCompare(b.agentId));

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

  return { generatedAt: now, verdicts, counts, overall, overallReason };
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
  for (const v of fleet.verdicts) {
    lines.push(`  [${v.state.toUpperCase().padEnd(7)}] ${v.displayName} — ${v.reason}`);
  }
  return lines.join("\n");
}
