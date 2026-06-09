/**
 * src/awareness/strategic-awareness.ts
 *
 * Strategic Awareness aggregator — the layer that turns "HartOS answers when asked"
 * into "HartOS notices and surfaces". It is PURE and DETERMINISTIC: it reads only
 * already-computed, grounded signals (the domain panels' coach/triage reasoning from
 * the Agent Depth patch, the freshness report, the proposal queue) and OPTIONALLY the
 * cross-system intelligence reports (perception / forecast / fleet synthesis) when a
 * caller has them. Same inputs → same brief.
 *
 * Honesty floor (Part G): every finding is earned by a concrete signal. Nothing is
 * speculated. When there isn't enough resolved data to stand on, the brief's status is
 * "insufficient_evidence" and the lists are empty — never a fabricated risk/opportunity.
 *
 * Noise control (Part F): findings are deduped by normalized text, ranked by severity,
 * and each list is capped. Weak signals don't surface; only meaningful, actionable ones.
 *
 * This module imports types only (no I/O, no clock, no Supabase) so it is Worker-safe and
 * reusable by both the Ask router (panels + freshness) and a dashboard view (which can
 * additionally pass perception/forecast/synthesis for cross-system corroboration).
 */

import type { DomainPanel, PanelField } from "../cockpit/panels/panel-types.js";
import type { FreshnessReport } from "../cockpit/freshness-surface.js";
import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
import type { PerceptionReport } from "../rinnegan/perception.js";
import type { ForecastReport } from "../prophet/forecast.js";
import type { FleetSynthesis } from "../fleet/fleet-synthesis.js";
import {
  executiveMemory,
  historicalContextFor,
  type MemorySnapshot,
  type MemoryStatus,
  type RecurringPattern,
  type Lesson,
} from "./executive-memory.js";

export type AwarenessConfidence = "high" | "medium" | "low";

export interface StrategicRisk {
  risk: string;
  why: string;
  evidence: string;
  confidence: AwarenessConfidence;
  suggestedAction: string;
  /** Executive-memory annotation when this risk has recurred before (e.g. "4× in 60d"). */
  historicalContext?: string;
}

export interface StrategicOpportunity {
  opportunity: string;
  why: string;
  upside: string;
  confidence: AwarenessConfidence;
  suggestedAction: string;
}

export interface StrategicDrift {
  drift: string;
  evidence: string;
  impact: string;
  suggestedCorrection: string;
}

export interface StrategicBlindSpot {
  /** The question Hart should be asking but isn't, framed from the evidence. */
  blindSpot: string;
  evidence: string;
}

export type AwarenessStatus = "ok" | "insufficient_evidence";

export interface StrategicBrief {
  status: AwarenessStatus;
  risks: StrategicRisk[];
  opportunities: StrategicOpportunity[];
  drift: StrategicDrift[];
  blindSpots: StrategicBlindSpot[];
  /** The single highest-leverage thing to look at now — null when nothing meaningful. */
  recommendedFocus: string | null;
  /** Honest one-liner: what was scanned + what could not be seen. */
  note: string;
  // ── Executive Memory evolution (Part F) — present only when history was supplied ──
  /** Recurring patterns from history; empty/absent when history is insufficient. */
  recurringPatterns?: RecurringPattern[];
  /** Evidence-based lessons; empty/absent when history is insufficient. */
  lessons?: Lesson[];
  /** Compact trend summary lines; empty/absent when history is insufficient. */
  trendSummary?: string[];
  /** "ok" | "insufficient_history" | undefined (no history supplied at all). */
  memoryStatus?: MemoryStatus;
}

export interface StrategicAwarenessInput {
  now: string;
  panels: DomainPanel[];
  freshness?: FreshnessReport | null;
  proposals?: ProposalQueueItem[];
  /** Optional cross-system enrichment — passed by the dashboard view; absent in the Ask router. */
  perception?: PerceptionReport | null;
  forecast?: ForecastReport | null;
  synthesis?: FleetSynthesis | null;
  /** Proposals older than this many hours count as backlog drift (default 72h). */
  agingHours?: number;
  /**
   * Executive Memory (Part F) — a supplied history of compact snapshots. When present, the
   * brief is enriched with recurring patterns / lessons / trend summary, and live risks get
   * a historicalContext annotation. Absent on the stateless Ask path; supplied by a future
   * persister/host. The brief is byte-identical to the no-history form when this is omitted.
   */
  history?: MemorySnapshot[];
}

// ─── small helpers ───────────────────────────────────────────────────────────

function field(panel: DomainPanel | undefined, key: string): PanelField | undefined {
  return panel?.fields.find((f) => f.key === key);
}
function okValue(panel: DomainPanel | undefined, key: string): string | null {
  const f = field(panel, key);
  return f && f.status === "ok" && f.value ? f.value : null;
}
function panelById(panels: DomainPanel[], id: string): DomainPanel | undefined {
  return panels.find((p) => p.id === id);
}
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
/** Map a panel confidence (high/medium/low/unknown) to awareness confidence; unknown → low. */
function confOf(panel: DomainPanel | undefined, key: string): AwarenessConfidence {
  const c = field(panel, key)?.confidence;
  return c === "high" ? "high" : c === "medium" ? "medium" : "low";
}
const HOURS = 1000 * 60 * 60;
function ageHours(iso: string | null | undefined, now: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  const n = Date.parse(now);
  if (Number.isNaN(t) || Number.isNaN(n) || t > n) return null;
  return (n - t) / HOURS;
}

// ─── detectors (each returns grounded findings only) ─────────────────────────

function detectRisks(input: StrategicAwarenessInput): StrategicRisk[] {
  const { panels, freshness, perception, forecast, synthesis } = input;
  const out: StrategicRisk[] = [];
  const ops = panelById(panels, "ops");
  const fitness = panelById(panels, "fitness");

  // Ops operational risks (stall / missing-follow-up / import-failure) — from the triage core.
  const opsRisks = okValue(ops, "triage_risks");
  if (opsRisks) {
    out.push({
      risk: "Operational risk in the ops queue",
      why: "Stuck or untended work tends to become a dead project no one owns.",
      evidence: opsRisks,
      confidence: confOf(ops, "triage_risks"),
      suggestedAction: okValue(ops, "next_action") ?? "Triage the leading ops front.",
    });
  }

  // Fitness physiological risk (injury / under-fuel / blind-flying) — from the coach core.
  const coachRisk = okValue(fitness, "coach_risk");
  if (coachRisk) {
    out.push({
      risk: "Training/recovery risk today",
      why: "Pushing against poor recovery is how a good week becomes an injury or a fatigue hole.",
      evidence: coachRisk,
      confidence: confOf(fitness, "coach_risk"),
      suggestedAction: okValue(fitness, "adjustment") ?? "Adjust today's session to match recovery.",
    });
  }

  // Stale / degrading data — the freshness report is the ground truth.
  if (freshness && freshness.staleDomains.length) {
    out.push({
      risk: "Decisions are running on stale data",
      why: "Every read against stale data stays wrong until it's refreshed — the error doesn't heal on its own.",
      evidence: `Stale domains: ${freshness.staleDomains.join(", ")}.${freshness.staleReason ? ` ${freshness.staleReason}` : ""}`,
      confidence: "high",
      suggestedAction: freshness.safeNextStep || "Refresh the stale source before acting on it.",
    });
  }

  // Cross-system corroborated risks (only when a caller supplied the synthesis).
  for (const r of (synthesis?.topRisks ?? []).slice(0, 2)) {
    if (r.severity < 2) continue; // noise control: only medium+ correlated risks
    out.push({
      risk: r.subject,
      why: r.why,
      evidence: `Corroborated by ${r.sources.join(" + ")}.`,
      confidence: r.confidence === "high" ? "high" : r.confidence === "medium" ? "medium" : "low",
      suggestedAction: "Review the corroborated risk across the contributing brains.",
    });
  }

  // High-severity, near-term forecast consequences (only when supplied).
  for (const c of (forecast?.consequences ?? []).filter((x) => x.severity === "high").slice(0, 2)) {
    out.push({
      risk: c.subject,
      why: c.projection,
      evidence: `Forecast horizon: ${c.horizon}.`,
      confidence: "medium",
      suggestedAction: c.preventedBy ?? "Act before the projected consequence lands.",
    });
  }

  // Perception criticals (only when supplied).
  for (const o of (perception?.observations ?? []).filter((x) => x.severity === "critical").slice(0, 2)) {
    out.push({
      risk: o.subject,
      why: o.detail,
      evidence: "Flagged critical by perception.",
      confidence: "high",
      suggestedAction: o.recommendation ?? "Address the critical observation.",
    });
  }

  return dedupeBy(out, (r) => norm(r.risk + " " + r.evidence));
}

function detectOpportunities(input: StrategicAwarenessInput): StrategicOpportunity[] {
  const { panels } = input;
  const out: StrategicOpportunity[] = [];
  const ops = panelById(panels, "ops");
  const fitness = panelById(panels, "fitness");

  // Ops quick win — cheap decision/approval clears unblock others' work (triage core).
  const opsOpp = okValue(ops, "triage_opportunity");
  if (opsOpp) {
    out.push({
      opportunity: "A cheap ops unblock is available",
      why: "Clearing a parked decision/approval is minutes of work that frees flow elsewhere.",
      upside: opsOpp,
      confidence: confOf(ops, "triage_opportunity"),
      suggestedAction: "Clear the parked decisions/approvals now.",
    });
  }

  // Fitness opportunity — unused capacity or a cheap recovery win (coach core).
  const coachOpp = okValue(fitness, "coach_opportunity");
  if (coachOpp) {
    out.push({
      opportunity: "A training/recovery opportunity is open today",
      why: "Capturing capacity (or an easy recovery win) compounds over a training block.",
      upside: coachOpp,
      confidence: confOf(fitness, "coach_opportunity"),
      suggestedAction: okValue(fitness, "adjustment") ?? "Act on the opportunity while it's available.",
    });
  }

  return dedupeBy(out, (o) => norm(o.opportunity + " " + o.upside));
}

function detectDrift(input: StrategicAwarenessInput): StrategicDrift[] {
  const { panels, freshness, proposals, now } = input;
  const out: StrategicDrift[] = [];
  const ops = panelById(panels, "ops");

  // Data drift — domains slipping out of the freshness window.
  if (freshness && (freshness.staleDomains.length || freshness.unavailableDomains.length)) {
    const ev: string[] = [];
    if (freshness.staleDomains.length) ev.push(`stale: ${freshness.staleDomains.join(", ")}`);
    if (freshness.unavailableDomains.length) ev.push(`unavailable: ${freshness.unavailableDomains.join(", ")}`);
    out.push({
      drift: "Data drift — the dashboard is diverging from reality",
      evidence: ev.join("; ") + ".",
      impact: "Decisions get made on a picture that no longer matches the board/wearable.",
      suggestedCorrection: freshness.safeNextStep || "Refresh the affected sources and re-check.",
    });
  }

  // Project drift — work that is BOTH blocked AND stale = an initiative quietly dying.
  const opsRisks = okValue(ops, "triage_risks") ?? "";
  if (/stall/i.test(opsRisks)) {
    out.push({
      drift: "Project drift — blocked work is also going stale",
      evidence: opsRisks,
      impact: "Initiatives that are stuck and untouched stop being anyone's responsibility and rot.",
      suggestedCorrection: "Decide each stalled item's fate: unblock, reassign, or formally close it.",
    });
  }

  // Confidence drift — a detected panel reporting low confidence means the system trusts itself less.
  for (const p of panels) {
    if (!p.detected) continue;
    if (p.confidence === "low") {
      out.push({
        drift: `Confidence drift — ${p.title} is operating on thin data`,
        evidence: `${p.title} panel confidence is low${p.gaps.length ? ` (${p.gaps[0]})` : ""}.`,
        impact: "Low-confidence answers look like answers — the risk is acting on them as if they were solid.",
        suggestedCorrection: p.nextAction || `Improve ${p.title} data completeness.`,
      });
    }
  }

  // Backlog drift — proposals aging past the threshold without a decision.
  const agingHours = input.agingHours ?? 72;
  const aging = (proposals ?? []).filter((p) => {
    if (p.status !== "draft" && p.status !== "pending_approval") return false;
    const h = ageHours(p.createdAt, now);
    return h != null && h >= agingHours;
  });
  if (aging.length) {
    out.push({
      drift: "Backlog drift — decisions are aging without resolution",
      evidence: `${aging.length} proposal(s) pending >${Math.round(agingHours)}h.`,
      impact: "The basis for each decision keeps going stale; approving later is riskier than approving now.",
      suggestedCorrection: "Clear or expire the aging proposals so the queue reflects live intent.",
    });
  }

  return dedupeBy(out, (d) => norm(d.drift));
}

function detectBlindSpots(input: StrategicAwarenessInput): StrategicBlindSpot[] {
  const { panels, freshness, perception, forecast } = input;
  const out: StrategicBlindSpot[] = [];

  // Unavailable domains — Hart can't be asking about a domain he can't see.
  if (freshness) {
    for (const d of freshness.unavailableDomains) {
      out.push({
        blindSpot: `Are you flying blind on ${d}? It has no resolvable data right now.`,
        evidence: `${d} is unavailable in the freshness report.`,
      });
    }
  }

  // Missing-source gaps from each panel.
  for (const p of panels) {
    for (const g of p.gaps) {
      if (/missing source/i.test(g)) {
        out.push({
          blindSpot: `${p.title}: a source is unwired — what would it show if connected?`,
          evidence: g,
        });
      }
    }
  }

  // Perception + forecast already name explicit blind spots when supplied.
  for (const b of [...(perception?.blindSpots ?? []), ...(forecast?.blindSpots ?? [])]) {
    out.push({ blindSpot: `Unseen: ${b} — is anything hiding there?`, evidence: b });
  }

  return dedupeBy(out, (b) => norm(b.blindSpot)).slice(0, 4);
}

// ─── noise control ───────────────────────────────────────────────────────────

function dedupeBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = key(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

const RISK_CAP = 4;
const OPP_CAP = 3;
const DRIFT_CAP = 3;

// ─── public entry point ──────────────────────────────────────────────────────

/**
 * Build the Strategic Brief. Pure + deterministic. Returns status
 * "insufficient_evidence" (and empty lists) when no domain panel resolved real data —
 * awareness is earned by data, never fabricated.
 */
export function strategicAwareness(input: StrategicAwarenessInput): StrategicBrief {
  const anyDetected = input.panels.some((p) => p.detected);
  const haveCross = !!(input.perception || input.forecast || input.synthesis);

  // Honesty floor: with no detected panel AND no cross-system reports, we have nothing
  // grounded to stand on. Say so rather than inventing findings.
  if (!anyDetected && !haveCross) {
    return {
      status: "insufficient_evidence",
      risks: [],
      opportunities: [],
      drift: [],
      blindSpots: [],
      recommendedFocus: null,
      note: "Insufficient evidence for a strategic brief — no domain panel has resolved live data yet. Configure/refresh the agent sources first.",
    };
  }

  const risks = detectRisks(input).slice(0, RISK_CAP);
  const opportunities = detectOpportunities(input).slice(0, OPP_CAP);
  const drift = detectDrift(input).slice(0, DRIFT_CAP);
  const blindSpots = detectBlindSpots(input);

  // Recommended focus: lead with the highest-confidence risk, else the sharpest drift,
  // else the best opportunity. Never invented — always points at a real finding.
  const topRisk = risks.find((r) => r.confidence === "high") ?? risks[0];
  const recommendedFocus = topRisk
    ? `${topRisk.risk} — ${topRisk.suggestedAction}`
    : drift[0]
      ? `${drift[0].drift} — ${drift[0].suggestedCorrection}`
      : opportunities[0]
        ? `${opportunities[0].opportunity} — ${opportunities[0].suggestedAction}`
        : null;

  const found = risks.length + opportunities.length + drift.length;
  const note = found
    ? `${risks.length} risk(s), ${opportunities.length} opportunity(ies), ${drift.length} drift signal(s), ${blindSpots.length} blind spot(s) — surfaced from grounded signals only.`
    : "Nothing meaningful to surface right now — no risks, drift, or opportunities crossed the threshold. That's a clear read, not a blind one.";

  const brief: StrategicBrief = { status: "ok", risks, opportunities, drift, blindSpots, recommendedFocus, note };

  // ── Executive Memory evolution (Part F) — enrich ONLY when history was supplied ──
  // When omitted, the brief above is returned unchanged (backward compatible).
  if (input.history) {
    const memory = executiveMemory(input.history, { now: input.now });
    brief.memoryStatus = memory.status;
    if (memory.status === "ok") {
      // Annotate live risks that have recurred before — "ops stale: 4× in 60d".
      for (const r of brief.risks) {
        const ctx = historicalContextFor(r.risk, memory);
        if (ctx) r.historicalContext = ctx;
      }
      brief.recurringPatterns = memory.recurringPatterns;
      brief.lessons = memory.lessons;
      brief.trendSummary = memory.trends.map((t) => `${t.metric}: ${t.direction} (${t.from}→${t.to})`);
    }
  }

  return brief;
}

/** One-line, deterministic summary of a brief (for embedding / a panel header). */
export function summarizeBrief(b: StrategicBrief): string {
  if (b.status === "insufficient_evidence") return "Strategic brief: insufficient evidence.";
  return `Strategic brief: ${b.risks.length} risk(s), ${b.opportunities.length} opp(s), ${b.drift.length} drift, ${b.blindSpots.length} blind spot(s).`;
}
