/**
 * src/read-models/agent-signal.ts
 *
 * Workstream C (X1): the unified cross-agent output contract, cockpit side. The
 * Fitness and Ops agents already expose toAgentSignal(); the cockpit needs the SAME
 * shape so it reasons over the fleet with no bespoke per-agent glue.
 *
 * Rather than re-fetch or duplicate each agent's verdict logic, this maps the existing
 * read-only ReadModelSummary (produced by the fitness/ops read-models from each agent's
 * read RPCs) into the shared AgentSignal — keeping the agents read-only (doctrine §2).
 * `confidence` is DERIVED from the read-model's own data-completeness confidence + read
 * status, never invented (§3); `freshness` is honest from the data's age (§4).
 *
 * Keep this interface IDENTICAL to the agents' (hart-os-fitness-trigger
 * src/lib/agent-signal.ts, ops-agent-v2 src/shared/agent-signal.ts).
 */

import type { ReadModelSummary, ReadModelType } from "./read-model-types.js";

export type AgentSignalConfidence = "high" | "medium" | "low" | "unknown";
export type AgentSignalFreshness = "live" | "fresh" | "stale" | "dead" | "unknown";

export interface AgentSignalFact {
  key: string;
  value: string | number | null;
  asOf: string | null;
  source: string;
}

export interface AgentSignal {
  verdict: string;
  confidence: AgentSignalConfidence;
  facts: AgentSignalFact[];
  freshness: AgentSignalFreshness;
  reason: string;
  nextAction: string | null;
  approvalNeeded: boolean;
}

export interface FleetSignal {
  id: string;
  type: ReadModelType;
  signal: AgentSignal;
}

/** Freshness from the data's age — honest "unknown" when no/!parseable timestamp. */
export function freshnessFromAge(asOf: string | null | undefined, now: Date): AgentSignalFreshness {
  if (!asOf) return "unknown";
  // dataFreshness may be a date (YYYY-MM-DD) or a full timestamp.
  const t = Date.parse(asOf.length <= 10 ? `${asOf}T00:00:00Z` : asOf);
  if (Number.isNaN(t)) return "unknown";
  const hours = (now.getTime() - t) / 3_600_000;
  if (hours < 0) return "unknown";
  if (hours <= 6) return "live";
  if (hours <= 24) return "fresh";
  if (hours <= 72) return "stale";
  return "dead";
}

/** Read health that isn't ok/degraded means we can't speak to the agent's state. */
function isSpeakable(status: ReadModelSummary["status"]): boolean {
  return status === "ok" || status === "degraded";
}

function deriveConfidence(summary: ReadModelSummary): AgentSignalConfidence {
  if (!isSpeakable(summary.status)) return "unknown";
  return summary.confidence; // low | medium | high — already derived in the read-model
}

function n(summary: ReadModelSummary, key: string): number {
  const value = summary.metrics[key];
  return typeof value === "number" ? value : 0;
}

/** The agent's headline state, from its own data — not the cockpit's read health. */
function deriveVerdict(summary: ReadModelSummary): string {
  if (!isSpeakable(summary.status)) return summary.status; // missing / error / disabled / unconfigured
  if (summary.type === "fitness") {
    const recovery = summary.metrics["recovery"];
    return recovery != null ? String(recovery) : "unknown";
  }
  if (summary.type === "ops") {
    if (n(summary, "urgentCards") > 0 || n(summary, "blockedCards") > 0) return "urgent";
    if (n(summary, "waitingCards") > 0) return "waiting";
    if (n(summary, "staleCards") > 0) return "stale";
    return "clear";
  }
  return summary.status;
}

function factsFrom(summary: ReadModelSummary): AgentSignalFact[] {
  const source = `cockpit-${summary.type}-read-model`;
  const asOf = summary.dataFreshness ?? null;
  const facts: AgentSignalFact[] = [{ key: "read_status", value: summary.status, asOf, source }];
  for (const [key, value] of Object.entries(summary.metrics)) {
    facts.push({ key, value, asOf, source });
  }
  for (const degraded of summary.degradedSources) {
    facts.push({ key: "degraded_source", value: degraded, asOf: null, source });
  }
  return facts;
}

/** Map one agent's read-model summary onto the shared AgentSignal. */
export function summaryToAgentSignal(summary: ReadModelSummary, opts: { now?: Date } = {}): AgentSignal {
  const now = opts.now ?? new Date();
  return {
    verdict: deriveVerdict(summary),
    confidence: deriveConfidence(summary),
    facts: factsFrom(summary),
    freshness: freshnessFromAge(summary.dataFreshness, now),
    reason: summary.lines[0] ?? summary.recommendation,
    nextAction: summary.recommendation || null,
    // Ops surfaces proposals that need human approval to act; Fitness is advisory.
    approvalNeeded: summary.type === "ops",
  };
}

/** One AgentSignal per agent — the cockpit fleet read-model. */
export function fleetSignals(summaries: ReadModelSummary[], opts: { now?: Date } = {}): FleetSignal[] {
  const now = opts.now ?? new Date();
  return summaries.map((summary) => ({
    id: summary.id,
    type: summary.type,
    signal: summaryToAgentSignal(summary, { now }),
  }));
}

/** Unified fleet view — every agent rendered identically from its AgentSignal. */
export function renderFleetView(fleet: FleetSignal[]): string {
  const lines = ["HartOS Fleet"];
  if (!fleet.length) {
    lines.push("- no agents configured");
    return lines.join("\n");
  }
  for (const { id, type, signal } of fleet) {
    lines.push(
      `- ${type} (${id}): verdict=${signal.verdict} · confidence=${signal.confidence} · ` +
        `freshness=${signal.freshness} · next=${signal.nextAction ?? "—"} · approval=${signal.approvalNeeded ? "required" : "no"}`,
    );
  }
  return lines.join("\n");
}
