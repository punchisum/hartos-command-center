/**
 * src/cockpit/decision-synthesis.ts
 *
 * The "Chief of Staff" — a PURE, deterministic synthesis that fuses every HartOS brain into the
 * 2-3 DECISIONS that matter most today, each with the cost of inaction and the specific ask.
 *
 * The intelligence is CORROBORATION: each brain (the strategic brief, Prophet's forecast, Executive
 * Memory's recurring patterns, the cross-agent fleet synthesis, drift, opportunities) votes on a
 * TOPIC. A topic flagged by several INDEPENDENT brains is more worth Hart's scarce attention than
 * any single panel — that cross-brain agreement is the signal a stack of separate cards can't show.
 *
 * Doctrine: PROPOSE, never act. Grounded only in the supplied reports — it invents no decision,
 * never launders confidence (cross-agent bands are carried verbatim), and is honest when there is
 * not enough to say. Worker-safe: TYPE-only imports, no I/O, no clock (now injected).
 */

import type { StrategicBrief } from "../awareness/strategic-awareness.js";
import type { ForecastReport } from "../prophet/forecast.js";
import type { ExecutiveMemoryReport } from "../awareness/executive-memory.js";
import type { ForecastAccuracy } from "../prophet/forecast-accuracy.js";

/** A cross-agent correlated risk (extracted from the fleet synthesis view, decoupled by shape). */
export interface CrossAgentRisk {
  subject: string;
  sources: string[];
  confidence: string;
}

export interface DecisionSynthesisInput {
  now: string;
  /** Each brain is optional — the synthesis fuses whatever is supplied (all guarded internally). */
  brief?: StrategicBrief;
  forecast?: ForecastReport;
  memory?: ExecutiveMemoryReport;
  /** Optional trust annotation — how often Prophet's past forecasts held. */
  accuracy?: ForecastAccuracy;
  /** Optional cross-agent correlated risks (from fleetSynthesisView.topRisks). */
  crossAgentRisks?: CrossAgentRisk[];
}

export type Leverage = "high" | "medium" | "low";
export type DecisionHorizon = "now" | "days" | "week+";

export interface Decision {
  id: string;
  /** The topic/area to decide on (the most descriptive contributing phrase). */
  title: string;
  /** Why it matters now — names the brains that corroborated it. */
  why: string;
  /** The specific thing Hart decides/does (preventedBy / suggestedAction / correction). */
  theAsk: string;
  /** What inaction costs — the entailed consequence, verbatim where available. */
  costOfInaction: string;
  leverage: Leverage;
  horizon: DecisionHorizon;
  /** Which brains flagged this topic (the corroboration set). */
  corroboration: string[];
  /** Ranking score (higher = more worth attention). Deterministic. */
  score: number;
  /** Evidence lines from the contributing brains. */
  basis: string[];
}

export interface DecisionBrief {
  status: "ok" | "insufficient_evidence";
  generatedAt: string;
  /** One-line CEO summary: the top decision + forecast verdict + accuracy trust. */
  headline: string;
  decisions: Decision[];
  /** Honest note: what was fused, and the forecast-accuracy trust signal. */
  note: string;
}

// ── scoring tunables (labeled, conservative) ──────────────────────────────────
const SEV: Record<string, number> = { high: 3, critical: 3, medium: 2, low: 1, unknown: 1 };
const HORIZON_SCORE: Record<DecisionHorizon, number> = { now: 3, days: 2, "week+": 1 };
const DOMAIN_KEYS = [
  "ops", "fitness", "factory", "proposal", "capability", "capacity", "deploy", "memory",
  "research", "git", "repo", "recovery", "nutrition", "sleep", "training", "backlog",
  "stale", "absorption", "forecast", "wolverine", "obsidian", "vault",
];

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Group contributions by TOPIC: a known domain keyword if present, else the longest token. */
function keyOf(subject: string): string {
  const n = norm(subject).replace(/^(recurring|trend|cross agent risk|consequence of inaction)\s+/, "");
  for (const k of DOMAIN_KEYS) if (n.includes(k)) return k;
  const tokens = n.split(" ").filter((t) => t.length > 3).sort((a, b) => b.length - a.length);
  return tokens[0] ?? n ?? "general";
}

interface Candidate {
  key: string;
  title: string;
  titleLen: number; // prefer the most descriptive title
  signals: Set<string>;
  sev: number;
  horizon: DecisionHorizon;
  recurrence: number;
  crossAgentSources: string[];
  why: string;
  theAsk: string;
  costOfInaction: string;
  basis: string[];
}

function horizonRank(h: DecisionHorizon): number {
  return HORIZON_SCORE[h];
}

/**
 * Fuse the brains into a ranked decision brief. Deterministic for a given input. Returns an honest
 * insufficient_evidence brief when no brain produced anything actionable.
 */
export function synthesizeDecisions(input: DecisionSynthesisInput, opts: { max?: number } = {}): DecisionBrief {
  const max = Math.max(1, opts.max ?? 3);
  const cands = new Map<string, Candidate>();

  const upsert = (
    subject: string,
    signal: string,
    fields: { sev?: number; horizon?: DecisionHorizon; recurrence?: number; crossAgent?: string[]; why?: string; theAsk?: string; costOfInaction?: string; basis?: string },
  ): void => {
    if (!subject || !subject.trim()) return;
    const key = keyOf(subject);
    const c =
      cands.get(key) ??
      {
        key,
        title: subject.trim(),
        titleLen: subject.trim().length,
        signals: new Set<string>(),
        sev: 0,
        horizon: "week+" as DecisionHorizon,
        recurrence: 0,
        crossAgentSources: [],
        why: "",
        theAsk: "",
        costOfInaction: "",
        basis: [],
      };
    c.signals.add(signal);
    // Keep the most descriptive title (longest contributing phrase).
    if (subject.trim().length > c.titleLen) {
      c.title = subject.trim();
      c.titleLen = subject.trim().length;
    }
    if (fields.sev != null) c.sev = Math.max(c.sev, fields.sev);
    if (fields.horizon && horizonRank(fields.horizon) > horizonRank(c.horizon)) c.horizon = fields.horizon;
    if (fields.recurrence != null) c.recurrence = Math.max(c.recurrence, fields.recurrence);
    if (fields.crossAgent) for (const s of fields.crossAgent) if (!c.crossAgentSources.includes(s)) c.crossAgentSources.push(s);
    // First non-empty wins for the directive fields (sources are added in priority order below).
    if (fields.theAsk && !c.theAsk) c.theAsk = fields.theAsk;
    if (fields.costOfInaction && !c.costOfInaction) c.costOfInaction = fields.costOfInaction;
    if (fields.why && !c.why) c.why = fields.why;
    if (fields.basis) c.basis.push(fields.basis);
    cands.set(key, c);
  };

  // Priority order matters: the FIRST source to set theAsk/costOfInaction/why wins, so we feed the
  // most directive brain first. Forecast gives the cleanest "cost of inaction" + "preventedBy".
  for (const f of input.forecast?.consequences ?? []) {
    upsert(f.subject, "forecast", {
      sev: SEV[f.severity] ?? 1,
      horizon: f.horizon,
      theAsk: f.preventedBy,
      costOfInaction: f.projection,
      why: `Prophet projects this if left alone`,
      basis: f.basis,
    });
  }
  for (const r of input.crossAgentRisks ?? []) {
    upsert(r.subject, "cross-agent", {
      sev: SEV[r.confidence] ?? 1,
      crossAgent: r.sources,
      why: `Correlated across ${r.sources.join(", ")} (confidence ${r.confidence})`,
      basis: `Cross-agent signal from ${r.sources.join(", ")}`,
    });
  }
  for (const r of input.brief?.risks ?? []) {
    upsert(r.risk, "risk", {
      sev: SEV[r.confidence] ?? 1,
      theAsk: r.suggestedAction,
      costOfInaction: r.why,
      why: r.why,
      basis: r.evidence,
      ...(r.historicalContext ? { recurrence: 1 } : {}),
    });
  }
  const recurring = (input.memory?.status === "ok" ? input.memory.recurringPatterns : []).filter(
    (p) => p.kind === "risk" || p.kind === "drift",
  );
  for (const p of recurring) {
    upsert(p.subject, "memory", {
      recurrence: p.occurrences,
      why: `Recurring ${p.occurrences}× — a standing condition, not a one-off`,
      basis: p.evidence,
    });
  }
  for (const d of input.brief?.drift ?? []) {
    upsert(d.drift, "drift", { theAsk: d.suggestedCorrection, costOfInaction: d.impact, basis: d.evidence });
  }
  for (const o of input.brief?.opportunities ?? []) {
    upsert(o.opportunity, "opportunity", {
      sev: SEV[o.confidence] ?? 1,
      theAsk: o.suggestedAction,
      costOfInaction: `Upside unrealized: ${o.upside}`,
      why: o.why,
    });
  }

  const scored: Decision[] = [...cands.values()]
    .map((c) => {
      const corroborationBonus = (c.signals.size - 1) * 2; // cross-brain agreement is the key signal
      const recurrenceBonus = Math.min(c.recurrence, 5);
      const crossAgentBonus = c.crossAgentSources.length >= 2 ? 2 : 0;
      const score = c.sev * 2 + horizonRank(c.horizon) + corroborationBonus + recurrenceBonus + crossAgentBonus;
      const leverage: Leverage = score >= 9 ? "high" : score >= 5 ? "medium" : "low";
      return {
        id: `decision-${c.key}`,
        title: c.title,
        why: c.why || `Flagged by ${[...c.signals].join(", ")}`,
        theAsk: c.theAsk || "Decide: act now, defer with intent, or accept the risk.",
        costOfInaction: c.costOfInaction || "Left unaddressed it persists until handled.",
        leverage,
        horizon: c.horizon,
        corroboration: [...c.signals],
        score,
        basis: c.basis.slice(0, 4),
      };
    })
    .sort((a, b) => b.score - a.score || b.corroboration.length - a.corroboration.length)
    .slice(0, max);

  const accNote =
    input.accuracy && input.accuracy.status === "ok"
      ? ` Forecast track record: ${Math.round(input.accuracy.persistenceRate * 100)}% of predicted consequences held.`
      : "";

  if (scored.length === 0) {
    return {
      status: "insufficient_evidence",
      generatedAt: input.now,
      headline: "No decisions surfaced — not enough live signal yet.",
      decisions: [],
      note: `Nothing crossed the threshold across the brief, forecast, memory, and fleet synthesis.${accNote} That's an honest read, not amnesia.`,
    };
  }

  const top = scored[0]!;
  const headline = `Decide first: ${top.title} — ${top.theAsk} (forecast ${input.forecast?.verdict ?? "unknown"}).${accNote}`;
  return {
    status: "ok",
    generatedAt: input.now,
    headline,
    decisions: scored,
    note: `Fused ${cands.size} topic(s) across the brief, Prophet forecast, Executive Memory, and fleet synthesis; ranked by severity × urgency × cross-brain corroboration.${accNote}`,
  };
}

/** One-line summary (for a header / the pulse). */
export function summarizeDecisionBrief(d: DecisionBrief): string {
  if (d.status === "insufficient_evidence") return "Decisions: not enough signal yet.";
  return `Top decision: ${d.decisions[0]!.title} (${d.decisions[0]!.leverage} leverage).`;
}
