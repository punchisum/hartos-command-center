/**
 * src/prophet/forecast.ts
 *
 * Phase F5 — Prophet's deterministic core: the CONSEQUENCE-OF-INACTION forecast.
 *
 * Prophet does NOT predict the world. It projects the logical CONSEQUENCE of leaving
 * KNOWN issues unaddressed — "if ops stays stale, every ops decision stays wrong; it
 * doesn't heal on its own." That's an entailment from observed evidence, not a
 * psychic guess, so it never fabricates. Its distinctive value over perception
 * (present-tense "what's wrong now") is forward-tense: it reads the ORCHESTRATOR's
 * deferrals and says when the fleet stops keeping up — "work is arriving with no path
 * to completion; the backlog grows until you add an agent / capacity." That ties the
 * whole F-chain (research → perception → fleet → orchestration) into a single
 * "what happens if you do nothing" answer.
 *
 * Pure, fs/network-free, deterministic. Honest about scope: it can only forecast the
 * consequences of issues it can SEE — it carries perception's blind spots forward as
 * things it explicitly cannot foresee.
 */

import type { PerceptionReport } from "../rinnegan/perception.js";
import type { FleetPlan } from "../fleet/orchestrator.js";
import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";

export type ForecastSeverity = "low" | "medium" | "high";
export type ForecastHorizon = "now" | "days" | "week+";
export type ForecastVerdict = "stable" | "degrading" | "urgent";

export interface Consequence {
  subject: string;
  /** The entailed consequence of inaction (projected, never fabricated). */
  projection: string;
  severity: ForecastSeverity;
  /** When it bites (deterministic bucket). */
  horizon: ForecastHorizon;
  /** The observed evidence this projects from. */
  basis: string;
  /** The action that prevents it. */
  preventedBy: string;
}

export interface ForecastReport {
  verdict: ForecastVerdict;
  /** Severity-ranked consequences of leaving the known issues unaddressed. */
  consequences: Consequence[];
  /** Honest coverage — which inputs were examined. */
  scanned: string[];
  /** What it cannot foresee (no evidence) — carried from perception's blind spots. */
  blindSpots: string[];
}

export interface ForecastInput {
  now: string;
  perception?: PerceptionReport | null;
  /** The orchestrator's plan — its deferrals are the accumulation signal (the F4 link). */
  plan?: FleetPlan | null;
  proposals?: ProposalQueueItem[];
  /** Pending-proposal age (hours) past which a stalled decision is projected. Default 72. */
  agingHours?: number;
}

const SEV_RANK: Record<ForecastSeverity, number> = { high: 3, medium: 2, low: 1 };

/**
 * Forecast the consequence of inaction. Deterministic: same input → same report.
 * Every consequence is backed by observed evidence (`basis`); nothing is invented.
 */
export function forecast(input: ForecastInput): ForecastReport {
  const consequences: Consequence[] = [];
  const scanned: string[] = [];
  const blindSpots: string[] = [];
  const nowMs = Date.parse(input.now);
  const agingHours = input.agingHours ?? 72;
  const agingDays = Math.round(agingHours / 24);

  let staleData = false;
  let deferredWork = false;

  // ── Perception → data-rot consequences (a present problem entails future wrongness) ──
  if (input.perception) {
    scanned.push("perception");
    for (const b of input.perception.blindSpots) if (!blindSpots.includes(b)) blindSpots.push(b);
    for (const o of input.perception.observations) {
      if (o.kind === "staleness" || o.kind === "drift") {
        staleData = true;
        consequences.push({
          subject: o.subject,
          projection: `Every decision that reads ${o.subject} stays wrong until it's refreshed — the error doesn't heal on its own.`,
          severity: o.severity === "critical" ? "high" : "medium",
          horizon: o.severity === "critical" ? "now" : "days",
          basis: o.detail,
          preventedBy: o.recommendation,
        });
      }
    }
  } else {
    blindSpots.push("perception (no report) — cannot forecast data-rot consequences");
  }

  // ── Orchestrator deferrals → accumulation consequences (the capstone F4 link) ──
  if (input.plan) {
    scanned.push("orchestration plan");
    const gap = input.plan.deferred.filter((d) => d.reason === "capability_gap");
    const cap = input.plan.deferred.filter((d) => d.reason === "capacity");
    if (gap.length) {
      deferredWork = true;
      const caps = [...new Set(gap.map((d) => d.task.targetCapability))].sort();
      consequences.push({
        subject: "fleet capability",
        projection: `${gap.length} task(s) needing ${caps.join(", ")} have no agent to do them — they accumulate with no path to completion.`,
        severity: "high",
        horizon: "week+",
        basis: `Orchestrator could not route ${gap.length} task(s): no agent has ${caps.join(", ")}.`,
        preventedBy: `Build an agent with the ${caps.join(", ")} capability.`,
      });
    }
    if (cap.length) {
      deferredWork = true;
      consequences.push({
        subject: "fleet capacity",
        projection: `${cap.length} task(s) exceed capacity each pass — the backlog grows until capacity rises or inflow slows.`,
        severity: "medium",
        horizon: "days",
        basis: `Orchestrator deferred ${cap.length} task(s) for capacity.`,
        preventedBy: "Raise the capable agents' capacity, or stagger the inflow.",
      });
    }
  }

  // ── Proposal queue → stalled-decision consequences ──
  const props = input.proposals ?? [];
  if (props.length) {
    scanned.push("proposal queue");
    const pending = props.filter((p) => p.status === "draft" || p.status === "pending_approval");
    const aging = pending.filter((p) => {
      const t = Date.parse(p.createdAt);
      return !Number.isNaN(t) && !Number.isNaN(nowMs) && (nowMs - t) / 3_600_000 > agingHours;
    });
    if (aging.length) {
      consequences.push({
        subject: "proposals",
        projection: `${aging.length} decision(s) have stalled >${agingDays}d; their basis keeps going stale, so approving them later gets riskier, not safer.`,
        severity: "medium",
        horizon: "days",
        basis: `${aging.length} pending proposal(s) older than ${agingDays}d.`,
        preventedBy: "Approve, reject, or expire the aging proposals.",
      });
    }
  }

  // ── Compounding: stale inputs AND uncleared work reinforce each other ──
  if (staleData && deferredWork) {
    consequences.push({
      subject: "system",
      projection: "Stale inputs and uncleared work compound: you'll be acting on old data with a backlog that's still growing.",
      severity: "high",
      horizon: "days",
      basis: "Both data staleness and deferred fleet work are present at once.",
      preventedBy: "Clear the wave-1 refresh/repair first, then expand capacity for the rest.",
    });
  }

  consequences.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
  const verdict: ForecastVerdict = consequences.some((c) => c.severity === "high" && (c.horizon === "now" || c.horizon === "days"))
    ? "urgent"
    : consequences.length
      ? "degrading"
      : "stable";

  return { verdict, consequences, scanned, blindSpots };
}

/** One-line, deterministic summary of a forecast (for embedding / the cockpit). */
export function summarizeForecast(r: ForecastReport): string {
  const body = r.consequences.length ? `${r.consequences.length} consequence(s) of inaction` : "no projected consequences";
  const blind = r.blindSpots.length ? ` · ${r.blindSpots.length} blind spot(s)` : "";
  return `Forecast ${r.verdict.toUpperCase()} — ${body}${blind}.`;
}
