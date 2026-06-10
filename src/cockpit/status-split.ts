/**
 * src/cockpit/status-split.ts — Live Organism P10: split the one overloaded verdict into honest,
 * separate status bands so a "training/recovery RED" (the OPERATOR's body) never implies the whole
 * HartOS SYSTEM is broken. Six distinct lenses: Operator · System Health · Fleet Health · Data
 * Freshness · Proposal Hygiene · Provider Connectivity. PURE + Worker-safe (no fs/clock/net).
 */

import type { MetaAgentRegistry } from "../agents/meta-agent-registry.js";

export type StatusBand = "green" | "amber" | "red" | "unknown";

export interface CockpitStatusGroup {
  key: "operator" | "system" | "fleet" | "freshness" | "proposals" | "provider";
  label: string;
  band: StatusBand;
  headline: string;
}

export interface CockpitStatusSplit {
  groups: CockpitStatusGroup[];
  /** The SYSTEM band — what the top-bar should reflect (NOT the operator's body status). */
  systemBand: StatusBand;
}

export interface StatusSplitInput {
  registry: MetaAgentRegistry;
  /** Operator (Hart's body) status from the fitness coach — kept SEPARATE from system health. */
  operator?: { band: StatusBand; headline: string } | null;
  freshness?: { staleCount: number; unavailableCount: number; note?: string } | null;
  proposals?: { aging: number; pending: number } | null;
}

const ORGANS = ["cockpit", "supabase", "execution-engine", "obsidian"];

export function computeStatusSplit(input: StatusSplitInput): CockpitStatusSplit {
  const reg = input.registry;
  const agents = reg.agents.filter((a) => a.category !== "human");
  const organs = agents.filter((a) => ORGANS.includes(a.id));
  // Domain + meta agents (the "fleet"), excluding organs.
  const fleet = agents.filter((a) => !a.isOrgan);
  const domains = agents.filter((a) => a.category === "domain");

  // System: the organs that keep HartOS itself running (cockpit/supabase/execution/obsidian).
  const organUnavailable = organs.filter((o) => o.status === "unavailable");
  const systemBand: StatusBand = organUnavailable.length ? "red" : "green";
  const system: CockpitStatusGroup = {
    key: "system",
    label: "System Health",
    band: systemBand,
    headline: organUnavailable.length
      ? `${organUnavailable.length} core organ(s) down: ${organUnavailable.map((o) => o.displayName).join(", ")}`
      : "Core organs operational (cockpit, state, execution, vault).",
  };

  // Fleet: how many agents are live vs partial vs unavailable.
  const live = fleet.filter((a) => a.status === "live").length;
  const partial = fleet.filter((a) => a.status === "partial" || a.status === "local_only").length;
  const unavailable = fleet.filter((a) => a.status === "unavailable").length;
  const fleetBand: StatusBand = unavailable > 0 ? "amber" : partial > 0 ? "amber" : "green";
  const fleetGroup: CockpitStatusGroup = {
    key: "fleet",
    label: "Fleet Health",
    band: fleetBand,
    headline: `${live} live · ${partial} partial · ${unavailable} unavailable`,
  };

  // Provider connectivity: domain agents whose data source is down (e.g. ops 401).
  const downProviders = domains.filter((a) => a.status === "unavailable");
  const provider: CockpitStatusGroup = {
    key: "provider",
    label: "Provider Connectivity",
    band: downProviders.length ? "red" : "green",
    headline: downProviders.length
      ? `${downProviders.map((a) => a.displayName).join(", ")} data source unavailable`
      : "Read-model providers reachable.",
  };

  // Operator (the human's body) — SEPARATE; defaults unknown when no fitness signal supplied.
  const operator: CockpitStatusGroup = {
    key: "operator",
    label: "Operator Status",
    band: input.operator?.band ?? "unknown",
    headline: input.operator?.headline ?? "No operator (fitness) signal resolved.",
  };

  // Data freshness.
  const fr = input.freshness;
  const freshness: CockpitStatusGroup = {
    key: "freshness",
    label: "Data Freshness",
    band: fr ? (fr.unavailableCount > 0 ? "red" : fr.staleCount > 0 ? "amber" : "green") : "unknown",
    headline: fr
      ? fr.staleCount + fr.unavailableCount === 0
        ? "All sources fresh."
        : `${fr.staleCount} stale · ${fr.unavailableCount} unavailable${fr.note ? ` — ${fr.note}` : ""}`
      : "Freshness not assessed.",
  };

  // Proposal hygiene.
  const pr = input.proposals;
  const proposals: CockpitStatusGroup = {
    key: "proposals",
    label: "Proposal Hygiene",
    band: pr ? (pr.aging > 0 ? "amber" : "green") : "unknown",
    headline: pr
      ? `${pr.pending} pending · ${pr.aging} aging`
      : "Proposal queue not assessed.",
  };

  return { groups: [operator, system, fleetGroup, freshness, proposals, provider], systemBand };
}
