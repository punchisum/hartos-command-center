/**
 * src/fleet/fleet-synthesis.ts — 3-levels-up master plan Level 3, the SCOPED SEED of the
 * "fleet intelligence" brain.
 *
 * HartOS already has several read-only fleet brains, each seeing ONE angle:
 *   • the Fleet Brain priority briefing (fleet-brain.ts)  — what matters now, per agent,
 *     with an HONEST confidence/freshness band.
 *   • Rinnegan perception (rinnegan/perception.ts)        — present-tense "what's wrong now"
 *     (staleness / drift / blind-spot / backlog), severity-ranked.
 *   • Prophet forecast (prophet/forecast.ts)              — forward-tense "what happens if you
 *     do nothing" (the entailed consequence of inaction).
 *
 * This module is a PURE, deterministic, RULE-FIRST SYNTHESIZER that composes those three into
 * ONE cross-agent rollup: the top CORRELATED risks across the fleet — each risk naming its
 * contributing sources and an HONEST confidence.
 *
 * NON-NEGOTIABLE honesty contract (plan §19, the no-laundering core):
 *   • A synthesized risk's confidence is CLAMPED to the WEAKEST contributing input's band, REUSING
 *     the Fleet Brain's `clampConfidence`. Combining sources NEVER upgrades confidence. Only the
 *     briefing carries a measured confidence band — and each band is ALREADY §19-resolved by
 *     fleet-brain (its own freshness penalty folded in), so the cross-source clamp takes the
 *     WEAKEST resolved band WITHOUT double-degrading. Perception and forecast carry SEVERITY but
 *     NO confidence, so they are NON-CONFIDENCE evidence (exactly like a StateDeltaSignal in the
 *     Fleet Brain): they corroborate and raise RANK, but can never raise confidence.
 *   • An UNAVAILABLE source is named honestly as reduced `coverage` — never silently ignored.
 *   • It NEVER fabricates: with nothing to synthesize it returns an honest empty rollup that
 *     names exactly which sources it could not see.
 *
 * Deterministic + Worker-safe: no fs / network / clock / env. It only composes already-built,
 * Worker-surfaced read models. NO LLM is wired here — the LLM-capable expansion comes later via
 * the existing Worker-safe Ask orchestrator seam, not from this pure rule core.
 */

import {
  clampConfidence,
  type FleetBriefing,
  type BriefingItem,
} from "./fleet-brain.js";
import type { AgentSignalConfidence } from "../read-models/agent-signal.js";
import type { PerceptionReport, ObservationSeverity } from "../rinnegan/perception.js";
import type { ForecastReport, ForecastSeverity } from "../prophet/forecast.js";

/** Which fleet brain a contributing signal came from — the cross-agent provenance. */
export type FleetSource = "briefing" | "perception" | "forecast";

/** Normalized 0–3 severity scale shared across the three brains (3 = most severe). */
export type FleetRiskSeverity = 0 | 1 | 2 | 3;

/** One synthesized cross-agent risk — its contributing sources + an HONEST confidence. */
export interface FleetRisk {
  /** The correlation key: the normalized domain/entity this risk is about. */
  subject: string;
  /** Which brains corroborate this risk (sorted, deduped) — the cross-agent signal. */
  sources: FleetSource[];
  /** The worst (highest) severity any contributing source assigned this subject. */
  severity: FleetRiskSeverity;
  /**
   * Clamped to the WEAKEST contributing band, degraded on stale/dead evidence (§19). Only the
   * briefing carries a measured band; a risk seen ONLY by perception/forecast has no measured
   * confidence and is honestly "unknown".
   */
  confidence: AgentSignalConfidence;
  /** Why it matters — the contributing evidence, joined, never fabricated. */
  why: string;
}

/** Honest coverage: which sources fed this rollup and which were absent / blind. */
export interface FleetSynthesisCoverage {
  /** Sources actually present in the inputs. */
  sources: FleetSource[];
  /** Sources NOT supplied — named, never silently ignored. */
  absentSources: FleetSource[];
  /** Blind spots carried up from perception + forecast (deduped, sorted). */
  blindSpots: string[];
}

export interface FleetSynthesis {
  /** Top correlated risks, ranked: severity desc, then cross-source corroboration, then subject. */
  topRisks: FleetRisk[];
  /** Honest coverage — what was seen and what was not. */
  coverage: FleetSynthesisCoverage;
  /** Rollup confidence = the WEAKEST band across the top risks (no laundering); unknown when empty. */
  confidence: AgentSignalConfidence;
  /** Honest one-line note — names the blind spots / absent sources when synthesis is thin. */
  note: string;
}

export interface FleetSynthesisInput {
  briefing?: FleetBriefing | null;
  perception?: PerceptionReport | null;
  forecast?: ForecastReport | null;
}

export interface FleetSynthesisOptions {
  /** How many top risks to surface. Default 8 (whole fleet is small — show the meaningful set). */
  limit?: number;
}

// ─── Correlation key (conservative — exact domain/entity token, no fuzzy merge) ──

/**
 * The correlation key is the normalized domain/entity token a signal is ABOUT. We merge two
 * signals ONLY when this token is byte-equal — a conservative key that will not over-merge
 * unrelated items (e.g. "ops" and "proposals" stay distinct). A briefing item exposes its
 * canonical `domain`; perception/forecast expose a `subject` string that is already a
 * domain/entity word (e.g. "ops", "fitness", "clickup", "proposals", "fleet capability").
 */
function correlationKey(raw: string): string {
  return raw.trim().toLowerCase();
}

// ─── Severity normalization onto a single 0–3 scale ──────────────────────────────

const PERCEPTION_SEVERITY: Record<ObservationSeverity, FleetRiskSeverity> = {
  critical: 3,
  warn: 2,
  info: 1,
};

const FORECAST_SEVERITY: Record<ForecastSeverity, FleetRiskSeverity> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * A briefing item's severity — derived from its OWN verdict word (the same vocabulary the
 * Fleet Brain ranks on), never invented. Mirrors fleet-brain.ts SIGNAL_SEVERITY so a synthesized
 * risk agrees with the briefing it came from. The verdict is encoded after the "<domain>: "
 * prefix in the briefing subject (matching how the Fleet Brain itself reads it).
 */
const BRIEFING_VERDICT_SEVERITY: Record<string, FleetRiskSeverity> = {
  error: 3,
  missing: 3,
  urgent: 3,
  red: 2,
  waiting: 2,
  stale: 2,
  amber: 1,
  green: 0,
  clear: 0,
};

function briefingItemSeverity(item: BriefingItem): FleetRiskSeverity {
  const verdict = item.subject.includes(": ")
    ? item.subject.slice(item.subject.indexOf(": ") + 2).trim().toLowerCase()
    : "";
  return BRIEFING_VERDICT_SEVERITY[verdict] ?? 1; // unknown verdict → mild attention, never silent
}

// ─── Accumulator: one bucket per correlation key ─────────────────────────────────

interface RiskBucket {
  subject: string;
  sources: Set<FleetSource>;
  severity: FleetRiskSeverity;
  /**
   * Confidence bands contributed by sources that carry one — ONLY the briefing does, and each
   * band is ALREADY §19-resolved (its own freshness penalty folded in by fleet-brain). The
   * cross-source clamp takes the WEAKEST of these; perception/forecast contribute none.
   */
  confidenceBands: AgentSignalConfidence[];
  /** Evidence lines, in source order (briefing → perception → forecast), deduped. */
  why: string[];
}

function bucketFor(buckets: Map<string, RiskBucket>, key: string): RiskBucket {
  let b = buckets.get(key);
  if (!b) {
    b = {
      subject: key,
      sources: new Set<FleetSource>(),
      severity: 0,
      confidenceBands: [],
      why: [],
    };
    buckets.set(key, b);
  }
  return b;
}

function addWhy(bucket: RiskBucket, line: string): void {
  const trimmed = line.trim();
  if (trimmed && !bucket.why.includes(trimmed)) bucket.why.push(trimmed);
}

// ─── Synthesis ────────────────────────────────────────────────────────────────────

/**
 * Synthesize ONE cross-agent rollup from the three fleet brains. Pure + deterministic: same
 * inputs ⇒ deep-equal output. All inputs are optional; an absent source degrades coverage
 * HONESTLY rather than fabricating. Confidence is CLAMPED via the Fleet Brain's `clampConfidence`
 * — combining sources never upgrades it (§19).
 */
export function synthesizeFleet(
  input: FleetSynthesisInput,
  opts: FleetSynthesisOptions = {},
): FleetSynthesis {
  const limit = opts.limit ?? 8;
  const buckets = new Map<string, RiskBucket>();

  const presentSources: FleetSource[] = [];
  const absentSources: FleetSource[] = [];
  const blindSpots = new Set<string>();

  // ── Briefing items → the ONLY source carrying a measured confidence + freshness band ──
  if (input.briefing) {
    presentSources.push("briefing");
    for (const item of input.briefing.items) {
      const key = correlationKey(item.domain);
      const bucket = bucketFor(buckets, key);
      bucket.sources.add("briefing");
      bucket.severity = Math.max(bucket.severity, briefingItemSeverity(item)) as FleetRiskSeverity;
      bucket.confidenceBands.push(item.confidence);
      addWhy(bucket, item.why);
    }
  } else {
    absentSources.push("briefing");
  }

  // ── Perception observations → present-tense facts; SEVERITY only, NO confidence band ──
  if (input.perception) {
    presentSources.push("perception");
    for (const o of input.perception.observations) {
      const key = correlationKey(o.subject);
      const bucket = bucketFor(buckets, key);
      bucket.sources.add("perception");
      bucket.severity = Math.max(bucket.severity, PERCEPTION_SEVERITY[o.severity]) as FleetRiskSeverity;
      addWhy(bucket, o.detail);
    }
    for (const b of input.perception.blindSpots) blindSpots.add(b);
  } else {
    absentSources.push("perception");
  }

  // ── Forecast consequences → forward-tense entailments; SEVERITY only, NO confidence band ──
  if (input.forecast) {
    presentSources.push("forecast");
    for (const c of input.forecast.consequences) {
      const key = correlationKey(c.subject);
      const bucket = bucketFor(buckets, key);
      bucket.sources.add("forecast");
      bucket.severity = Math.max(bucket.severity, FORECAST_SEVERITY[c.severity]) as FleetRiskSeverity;
      addWhy(bucket, c.projection);
    }
    for (const b of input.forecast.blindSpots) blindSpots.add(b);
  } else {
    absentSources.push("forecast");
  }

  // ── Resolve every bucket into an HONEST risk ──
  const SOURCE_ORDER: Record<FleetSource, number> = { briefing: 0, perception: 1, forecast: 2 };
  const risks: FleetRisk[] = [...buckets.values()].map((bucket) => {
    const sources = [...bucket.sources].sort((a, b) => SOURCE_ORDER[a] - SOURCE_ORDER[b]);
    // §19 clamp, REUSING the Fleet Brain helper. The confidence inputs are ONLY the bands from
    // sources that carry one (the briefing) — and each briefing band is ALREADY §19-resolved
    // (fleet-brain folded that item's own freshness penalty into it). So the cross-source clamp's
    // job is purely to take the WEAKEST already-resolved band; we pass freshness "live" to avoid
    // DOUBLE-degrading a band that already encodes its own staleness. Perception/forecast carry NO
    // band, so they can corroborate (raising rank) but never raise confidence. With no briefing
    // contribution there is no measured band → clampConfidence([], "live") = "unknown" (honest).
    const confidence = clampConfidence(bucket.confidenceBands, "live");
    return {
      subject: bucket.subject,
      sources,
      severity: bucket.severity,
      confidence,
      why: bucket.why.join(" "),
    };
  });

  // ── Ranking: severity desc → cross-source corroboration desc → subject tiebreak (stable) ──
  risks.sort((a, b) => {
    if (a.severity !== b.severity) return b.severity - a.severity;
    if (a.sources.length !== b.sources.length) return b.sources.length - a.sources.length;
    return a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0;
  });

  const topRisks = risks.slice(0, limit);

  // ── Rollup confidence = the WEAKEST band across the top risks (no laundering upward) ──
  const rollupConfidence = weakestConfidence(topRisks.map((r) => r.confidence));

  return {
    topRisks,
    coverage: {
      sources: presentSources,
      absentSources,
      blindSpots: [...blindSpots].sort(),
    },
    confidence: rollupConfidence,
    note: buildNote(topRisks, presentSources, absentSources, [...blindSpots].sort()),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────

const CONFIDENCE_RANK: Record<AgentSignalConfidence, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
};
const CONFIDENCE_BY_RANK: AgentSignalConfidence[] = ["unknown", "low", "medium", "high"];

/** The weakest (lowest-rank) confidence band across a set; "unknown" when empty. */
function weakestConfidence(bands: AgentSignalConfidence[]): AgentSignalConfidence {
  if (bands.length === 0) return "unknown";
  const rank = Math.min(...bands.map((b) => CONFIDENCE_RANK[b]));
  return CONFIDENCE_BY_RANK[rank]!;
}

/** An honest one-line note — names absent sources + blind spots, never implies it saw more. */
function buildNote(
  topRisks: FleetRisk[],
  present: FleetSource[],
  absent: FleetSource[],
  blindSpots: string[],
): string {
  if (present.length === 0) {
    return "No fleet brains available — nothing to synthesize (briefing, perception, forecast all absent).";
  }
  const correlated = topRisks.filter((r) => r.sources.length > 1).length;
  const parts: string[] = [];
  if (topRisks.length === 0) {
    parts.push(`No risks surfaced across ${present.join(", ")}.`);
  } else {
    parts.push(
      `${topRisks.length} risk(s) across ${present.join(", ")}` +
        (correlated ? `; ${correlated} cross-agent corroborated.` : "; none cross-agent corroborated."),
    );
  }
  if (absent.length) parts.push(`Reduced coverage — absent: ${absent.join(", ")}.`);
  if (blindSpots.length) parts.push(`Blind spots: ${blindSpots.join(", ")}.`);
  return parts.join(" ");
}
