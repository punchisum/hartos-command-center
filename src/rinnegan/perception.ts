/**
 * src/rinnegan/perception.ts
 *
 * Phase F2 — Rinnegan's deterministic core: cross-system PERCEPTION over the state
 * the cockpit already has. Pure + fs/network-free, in the Phase A/B reasoning
 * style. It surfaces what's wrong ACROSS systems — staleness, drift, blind spots,
 * and backlog — ranked by severity, and is scrupulously honest about its own
 * coverage: it reports what it `scanned` and, crucially, the `blindSpots` it could
 * NOT see. It never invents a problem it has no evidence for.
 *
 * Per the blueprint, perception (Rinnegan) comes BEFORE multi-agent — you cannot
 * coordinate agents you cannot accurately see.
 */

import type { FreshnessReport } from "../cockpit/freshness-surface.js";
import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";

export type ObservationKind = "staleness" | "drift" | "blind_spot" | "backlog";
export type ObservationSeverity = "info" | "warn" | "critical";
export type PerceptionVerdict = "clear" | "watch" | "attention";

export interface Observation {
  kind: ObservationKind;
  severity: ObservationSeverity;
  subject: string;
  /** The perceived fact (never fabricated). */
  detail: string;
  /** Deterministic next step. */
  recommendation: string;
}

export interface PerceptionReport {
  verdict: PerceptionVerdict;
  /** Severity-ranked (critical → info). */
  observations: Observation[];
  /** Honest coverage — what was actually examined. */
  scanned: string[];
  /** What perception could NOT see (no data) — named, not guessed at. */
  blindSpots: string[];
}

export interface PerceptionInput {
  now: string;
  freshness?: FreshnessReport | null;
  proposals?: ProposalQueueItem[];
  /** Source NAMES that are configured-but-unresolved (from source diagnostics). */
  missingSources?: string[];
  /** Pending-proposal age (hours) past which it counts as backlog. Default 72. */
  agingHours?: number;
}

function cap(s: string): string {
  return s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s;
}

const SEVERITY_RANK: Record<ObservationSeverity, number> = { critical: 3, warn: 2, info: 1 };

/**
 * Perceive the cross-system state deterministically. Same input → same report.
 * Observations are evidence-backed; blindSpots make the gaps explicit rather than
 * silently implying everything is fine.
 */
export function perceive(input: PerceptionInput): PerceptionReport {
  const observations: Observation[] = [];
  const scanned: string[] = [];
  const blindSpots: string[] = [];
  const nowMs = Date.parse(input.now);
  const agingHours = input.agingHours ?? 72;

  // ── Freshness → staleness / drift / blind-spot ──
  if (input.freshness) {
    scanned.push("data freshness");
    for (const d of input.freshness.domains) {
      if (d.state === "stale") {
        observations.push({
          kind: "staleness",
          severity: d.domain === "ops" ? "critical" : "warn",
          subject: d.domain,
          detail: `${cap(d.domain)} data is stale${d.lastUpdated ? ` (last updated ${d.lastUpdated})` : ""}.`,
          recommendation: `Refresh ${d.domain} before acting on its numbers.`,
        });
      } else if (d.state === "reports_only") {
        observations.push({
          kind: "drift",
          severity: "warn",
          subject: d.domain,
          detail: `${cap(d.domain)} is running on reports only — its live read-model isn't resolving.`,
          recommendation: `Reconnect the ${d.domain} live read-model so the cockpit sees current data.`,
        });
      } else if (d.state === "unavailable") {
        observations.push({
          kind: "blind_spot",
          severity: "warn",
          subject: d.domain,
          detail: `${cap(d.domain)} has no resolvable data — a blind spot.`,
          recommendation: `Configure the ${d.domain} read-model to bring it into view.`,
        });
        blindSpots.push(d.domain);
      }
    }
    if (input.freshness.clickup?.stale) {
      observations.push({
        kind: "staleness",
        severity: "critical",
        subject: "clickup",
        detail: "The ClickUp import is stale — every Ops verdict is computed on old data.",
        recommendation: "Re-run the ClickUp import, then re-check Ops.",
      });
    }
  } else {
    blindSpots.push("data freshness (no panels resolved)");
  }

  // ── Configured-but-missing sources → blind spots ──
  if (input.missingSources) {
    scanned.push("source diagnostics");
    for (const s of input.missingSources) {
      observations.push({
        kind: "blind_spot",
        severity: "info",
        subject: s,
        detail: `Source "${s}" is configured but not resolving — currently invisible.`,
        recommendation: `Provide the ${s} env/credential to bring it online.`,
      });
      if (!blindSpots.includes(s)) blindSpots.push(s);
    }
  }

  // ── Proposal queue → backlog ──
  const props = input.proposals ?? [];
  if (props.length) {
    scanned.push("proposal queue");
    const pending = props.filter((p) => p.status === "draft" || p.status === "pending_approval");
    const aging = pending.filter((p) => {
      const t = Date.parse(p.createdAt);
      return !Number.isNaN(t) && !Number.isNaN(nowMs) && (nowMs - t) / 3_600_000 > agingHours;
    });
    if (aging.length) {
      observations.push({
        kind: "backlog",
        severity: "warn",
        subject: "proposals",
        detail: `${aging.length} proposal(s) have been pending more than ${Math.round(agingHours / 24)}d.`,
        recommendation: "Approve, reject, or expire the aging proposals to keep the queue honest.",
      });
    } else if (pending.length >= 5) {
      observations.push({
        kind: "backlog",
        severity: "info",
        subject: "proposals",
        detail: `${pending.length} proposals are pending review.`,
        recommendation: "Triage the proposal queue.",
      });
    }
  }

  observations.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const verdict: PerceptionVerdict = observations.some((o) => o.severity === "critical")
    ? "attention"
    : observations.some((o) => o.severity === "warn")
      ? "watch"
      : "clear";

  return { verdict, observations, scanned, blindSpots };
}

/** One-line, deterministic summary of a perception report (for embedding). */
export function summarizePerception(r: PerceptionReport): string {
  const counts = r.observations.reduce<Record<string, number>>((acc, o) => {
    acc[o.kind] = (acc[o.kind] ?? 0) + 1;
    return acc;
  }, {});
  const parts = Object.entries(counts).map(([k, n]) => `${n} ${k}`);
  const body = parts.length ? parts.join(", ") : "nothing flagged";
  const blind = r.blindSpots.length ? ` · ${r.blindSpots.length} blind spot(s)` : "";
  return `Perception ${r.verdict.toUpperCase()} — ${body}${blind}.`;
}
