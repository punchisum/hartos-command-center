/**
 * src/fleet/fleet-os.ts
 *
 * Phase F3 — Fleet OS, V1 (deliberately lean). A declarative agent REGISTRY plus a
 * PURE health assessment over the live fleet signals. Kept minimal on purpose: with
 * only a handful of agents, a full registry-driven rewrite of the fleet/detail
 * surfaces would be premature (depth before breadth). What this DOES add over the
 * signal-driven fleet view: it knows which agents are SUPPOSED to exist, so it can
 * flag a registered agent that is reporting nothing ("silent") — a blind spot the
 * signal-only view can't surface. Deterministic; no fabricated health.
 */

import type { FleetSignal } from "../read-models/agent-signal.js";

export type AgentKind = "core" | "generated";

export interface AgentRegistration {
  id: string;
  name: string;
  icon: string;
  /** The read-model type carrying this agent's live signal, if it has one. */
  signalType?: string;
  kind: AgentKind;
  /** What kinds of work this agent can take (used by task routing — F4 substrate). */
  capabilities: string[];
  /** Max concurrent tasks before it's over-subscribed (used by load assessment — F4). */
  capacity: number;
  note?: string;
}

/** The agents HartOS knows about. Adding an agent = one entry here. */
export const FLEET_REGISTRY: AgentRegistration[] = [
  { id: "fitness", name: "Fitness", icon: "🏃", signalType: "fitness", kind: "core", capabilities: ["fitness", "recovery", "nutrition"], capacity: 2 },
  { id: "ops", name: "Ops", icon: "📋", signalType: "ops", kind: "core", capabilities: ["ops", "followup", "refresh", "repair"], capacity: 3 },
  { id: "research", name: "Research", icon: "🔬", kind: "core", capabilities: ["research", "analysis"], capacity: 2, note: "planner — no live read-model signal yet" },
];

export type AgentHealth = "online" | "stale" | "silent" | "advisory";
export type FleetVerdict = "healthy" | "degraded" | "attention";

export interface FleetAgentStatus {
  id: string;
  name: string;
  icon: string;
  kind: AgentKind;
  health: AgentHealth;
  freshness: string | null;
  confidence: string | null;
  /** Honest, evidence-backed description. */
  detail: string;
}

export interface FleetHealthReport {
  verdict: FleetVerdict;
  agents: FleetAgentStatus[];
  online: number;
  stale: number;
  silent: number;
}

/**
 * Assess fleet health: match each registered agent to its live signal (by read-model
 * type). An agent that declares a signalType but has no signal is "silent" (the gap
 * the signal-only view misses); one with no signalType is "advisory" (e.g. a planner).
 * Deterministic: same signals → same report.
 */
export function assessFleet(signals: FleetSignal[], opts: { registry?: AgentRegistration[] } = {}): FleetHealthReport {
  const registry = opts.registry ?? FLEET_REGISTRY;
  const agents: FleetAgentStatus[] = registry.map((reg) => {
    const baseInfo = { id: reg.id, name: reg.name, icon: reg.icon, kind: reg.kind };
    if (!reg.signalType) {
      return {
        ...baseInfo,
        health: "advisory" as AgentHealth,
        freshness: null,
        confidence: null,
        detail: `${reg.name} is advisory${reg.note ? ` (${reg.note})` : ""} — no live read-model signal expected.`,
      };
    }
    const sig = signals.find((s) => s.type === reg.signalType);
    if (!sig) {
      return {
        ...baseInfo,
        health: "silent" as AgentHealth,
        freshness: null,
        confidence: null,
        detail: `${reg.name} is registered but reporting no signal — silent (check its read-model wiring).`,
      };
    }
    const f = sig.signal.freshness;
    const health: AgentHealth = f === "live" || f === "fresh" ? "online" : f === "stale" || f === "dead" ? "stale" : "silent";
    return {
      ...baseInfo,
      health,
      freshness: f,
      confidence: sig.signal.confidence,
      detail: `${reg.name}: ${health} — freshness ${f}, confidence ${sig.signal.confidence}.`,
    };
  });

  const online = agents.filter((a) => a.health === "online").length;
  const stale = agents.filter((a) => a.health === "stale").length;
  const silent = agents.filter((a) => a.health === "silent").length;
  const verdict: FleetVerdict = silent > 0 ? "attention" : stale > 0 ? "degraded" : "healthy";
  return { verdict, agents, online, stale, silent };
}
