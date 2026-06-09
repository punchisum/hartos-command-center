/**
 * src/awareness/executive-memory.ts
 *
 * Executive Memory — the layer that turns "HartOS understands the present" into
 * "HartOS understands history, recurring patterns, decision quality, and trends".
 *
 *   History → Patterns → (feeds) → Awareness → Recommendations
 *
 * PURE + DETERMINISTIC. It operates over a SUPPLIED list of compact, evidenced
 * `MemorySnapshot`s — it neither reads a DB nor a clock nor the filesystem. HartOS does
 * not persist history yet; this module is the CONTRACT + the reasoning. A future host
 * (a Node persister, Obsidian, a research system — Part L) supplies the snapshot list;
 * nothing here changes when it does. One-directional: awareness may depend on memory,
 * never the reverse.
 *
 * The discipline is "remember what matters", not "remember everything":
 *   - A single occurrence is NOT a memory. Patterns require recurrence (≥ MIN_OCCURRENCES).
 *   - Snapshots are compact projections of a brief (finding subjects + a few metrics +
 *     optional decisions), never raw chatter (see `snapshotFromBrief`).
 *   - Honesty floor (Part H): < MIN_HISTORY snapshots ⇒ status "insufficient_history",
 *     empty lists. No invented patterns / trends / lessons. No synthetic wisdom.
 *   - Noise control (Part J): quality scoring + ranking + per-list caps + age pruning.
 */

import type { AwarenessConfidence, StrategicBrief } from "./strategic-awareness.js";

export type MemoryStatus = "ok" | "insufficient_history";
export type PatternKind = "risk" | "drift" | "opportunity" | "blind_spot";
export type TrendDirection = "rising" | "falling" | "stable" | "unknown";

/** A named numeric metric captured at a point in time, for trend detection. */
export interface MemoryMetric {
  key: string;
  value: number;
}

/** A meaningful decision worth remembering (Part B) — date + evidence + optional outcome. */
export interface DecisionRecord {
  decision: string;
  domain: string;
  at: string;
  evidence: string;
  /** Known outcome if observed later, else null/undefined (honest about the unknown). */
  outcome?: string | null;
}

/**
 * A compact, evidenced projection of a StrategicBrief at one point in time. This is the
 * UNIT OF MEMORY — finding subjects + a few metrics + any decisions. NOT raw events.
 * Serializable plain data, so a future persister can store/replay it unchanged.
 */
export interface MemorySnapshot {
  at: string;
  riskSubjects: string[];
  driftSubjects: string[];
  opportunitySubjects: string[];
  blindSpotSubjects: string[];
  metrics: MemoryMetric[];
  decisions?: DecisionRecord[];
}

export interface RecurringPattern {
  kind: PatternKind;
  subject: string;
  occurrences: number;
  windowDays: number;
  firstSeen: string;
  lastSeen: string;
  evidence: string;
  /** Ranking score — higher = more worth Hart's attention (recurrence × recency × spread). */
  qualityScore: number;
}

export interface MemoryTrend {
  metric: string;
  direction: TrendDirection;
  from: number;
  to: number;
  windowDays: number;
  evidence: string;
}

export interface Lesson {
  lesson: string;
  basis: string;
  confidence: AwarenessConfidence;
  /** Linked source subjects/metrics so the lesson is explainable, never free-floating. */
  sourceSubjects: string[];
}

export interface ExecutiveMemoryReport {
  status: MemoryStatus;
  recurringPatterns: RecurringPattern[];
  trends: MemoryTrend[];
  lessons: Lesson[];
  /** Meaningful decisions, most recent first (ranked + capped). */
  decisions: DecisionRecord[];
  note: string;
}

export interface ExecutiveMemoryOptions {
  /** "Now" for recency/window math (injected — never read from a clock). */
  now: string;
  /** Only consider snapshots within this many days (default 60). */
  windowDays?: number;
  /** Minimum snapshots required before any memory is earned (default 3). */
  minHistory?: number;
  /** Minimum occurrences for a subject to count as a recurring pattern (default 2). */
  minOccurrences?: number;
}

// ─── tunables (labeled, conservative) ────────────────────────────────────────
const DEFAULT_WINDOW_DAYS = 60;
const DEFAULT_MIN_HISTORY = 3;
const DEFAULT_MIN_OCCURRENCES = 2;
/** A subject must recur this many times to seed a (descriptive) lesson. */
const LESSON_MIN_OCCURRENCES = 3;
/** Relative change needed to call a metric trend rising/falling (else stable). */
const TREND_THRESHOLD = 0.15;
const PATTERN_CAP = 5;
const TREND_CAP = 5;
const LESSON_CAP = 3;
const DECISION_CAP = 5;
const HOURS = 1000 * 60 * 60;
const DAY = 24 * HOURS;

// ─── helpers ─────────────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function daysBetween(aIso: string, bIso: string): number | null {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.abs(b - a) / DAY;
}

/**
 * Project a StrategicBrief into a compact MemorySnapshot. Stores only the finding
 * SUBJECTS (deduped, normalized) + a few numeric metrics — never the prose, never raw
 * chatter. `at` is supplied (no clock). Decisions are passed through if the caller knows them.
 */
export function snapshotFromBrief(brief: StrategicBrief, at: string, decisions?: DecisionRecord[]): MemorySnapshot {
  const uniq = (xs: string[]): string[] => [...new Set(xs.map(norm).filter(Boolean))];
  // Ordinal confidence metric: average of the risks' confidence (high=3/med=2/low=1).
  const confVal = (c: AwarenessConfidence): number => (c === "high" ? 3 : c === "medium" ? 2 : 1);
  const avgRiskConf = brief.risks.length
    ? brief.risks.reduce((s, r) => s + confVal(r.confidence), 0) / brief.risks.length
    : 0;
  return {
    at,
    riskSubjects: uniq(brief.risks.map((r) => r.risk)),
    driftSubjects: uniq(brief.drift.map((d) => d.drift)),
    opportunitySubjects: uniq(brief.opportunities.map((o) => o.opportunity)),
    blindSpotSubjects: uniq(brief.blindSpots.map((b) => b.blindSpot)),
    metrics: [
      { key: "risk_count", value: brief.risks.length },
      { key: "drift_count", value: brief.drift.length },
      { key: "opportunity_count", value: brief.opportunities.length },
      { key: "blind_spot_count", value: brief.blindSpots.length },
      { key: "avg_risk_confidence", value: Math.round(avgRiskConf * 100) / 100 },
    ],
    ...(decisions && decisions.length ? { decisions } : {}),
  };
}

/**
 * Prune a raw snapshot list to the window + sort oldest→newest. Pure: drops anything
 * outside `windowDays` of `now` and anything with an unparseable timestamp. This is the
 * memory-compactness control — old context ages out instead of accumulating forever.
 */
export function pruneSnapshots(history: MemorySnapshot[], now: string, windowDays = DEFAULT_WINDOW_DAYS): MemorySnapshot[] {
  return history
    .filter((s) => {
      const d = daysBetween(s.at, now);
      return d != null && d <= windowDays;
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// ─── detectors ───────────────────────────────────────────────────────────────

function detectPatterns(snaps: MemorySnapshot[], now: string, windowDays: number, minOcc: number): RecurringPattern[] {
  const kinds: Array<{ kind: PatternKind; pick: (s: MemorySnapshot) => string[] }> = [
    { kind: "risk", pick: (s) => s.riskSubjects },
    { kind: "drift", pick: (s) => s.driftSubjects },
    { kind: "opportunity", pick: (s) => s.opportunitySubjects },
    { kind: "blind_spot", pick: (s) => s.blindSpotSubjects },
  ];
  const out: RecurringPattern[] = [];
  for (const { kind, pick } of kinds) {
    const bySubject = new Map<string, string[]>(); // subject → list of snapshot dates it appeared in
    for (const s of snaps) {
      for (const subj of new Set(pick(s))) {
        const arr = bySubject.get(subj) ?? [];
        arr.push(s.at);
        bySubject.set(subj, arr);
      }
    }
    for (const [subject, dates] of bySubject) {
      if (dates.length < minOcc) continue; // single/sub-threshold occurrences are NOT memories
      const sorted = [...dates].sort((a, b) => Date.parse(a) - Date.parse(b));
      const firstSeen = sorted[0]!;
      const lastSeen = sorted[sorted.length - 1]!;
      const recencyDays = daysBetween(lastSeen, now) ?? windowDays;
      // Quality: recurrence count, weighted up by recency (recent recurring issues matter more).
      const recencyWeight = 1 + Math.max(0, (windowDays - recencyDays) / windowDays);
      const qualityScore = Math.round(dates.length * recencyWeight * 100) / 100;
      out.push({
        kind,
        subject,
        occurrences: dates.length,
        windowDays,
        firstSeen,
        lastSeen,
        evidence: `Occurred ${dates.length}× in the last ${Math.round(windowDays)} days (last seen ${lastSeen}).`,
        qualityScore,
      });
    }
  }
  return out.sort((a, b) => b.qualityScore - a.qualityScore || b.occurrences - a.occurrences).slice(0, PATTERN_CAP);
}

function detectTrends(snaps: MemorySnapshot[], windowDays: number): MemoryTrend[] {
  // Collect each metric's series in chronological order.
  const series = new Map<string, Array<{ at: string; value: number }>>();
  for (const s of snaps) {
    for (const m of s.metrics) {
      const arr = series.get(m.key) ?? [];
      arr.push({ at: s.at, value: m.value });
      series.set(m.key, arr);
    }
  }
  const out: MemoryTrend[] = [];
  for (const [metric, pts] of series) {
    if (pts.length < 3) {
      // Not enough points to claim a direction — honest "unknown" only if it exists at all.
      continue;
    }
    const half = Math.floor(pts.length / 2);
    const earlier = pts.slice(0, half);
    const recent = pts.slice(pts.length - half);
    const avg = (xs: typeof pts): number => xs.reduce((s, p) => s + p.value, 0) / xs.length;
    const from = Math.round(avg(earlier) * 100) / 100;
    const to = Math.round(avg(recent) * 100) / 100;
    const base = Math.abs(from) < 1e-9 ? (Math.abs(to) < 1e-9 ? 1 : Math.abs(to)) : Math.abs(from);
    const rel = (to - from) / base;
    const direction: TrendDirection = rel > TREND_THRESHOLD ? "rising" : rel < -TREND_THRESHOLD ? "falling" : "stable";
    out.push({
      metric,
      direction,
      from,
      to,
      windowDays,
      evidence: `${metric}: ${from} → ${to} across ${pts.length} snapshot(s) over ${Math.round(windowDays)} days.`,
    });
  }
  return out.slice(0, TREND_CAP);
}

function deriveLessons(patterns: RecurringPattern[], snaps: MemorySnapshot[]): Lesson[] {
  const out: Lesson[] = [];
  // Decisions seen across the window, for causal phrasing when they exist.
  const decisions = snaps.flatMap((s) => s.decisions ?? []);

  for (const p of patterns) {
    if (p.occurrences < LESSON_MIN_OCCURRENCES) continue; // a lesson needs a real, repeated pattern

    if (p.kind === "opportunity" || p.kind === "risk" || p.kind === "drift") {
      // Causal lesson ONLY when a decision plausibly relates (shared word) — else descriptive.
      const related = decisions.find((d) => norm(d.decision).split(" ").some((w) => w.length > 3 && p.subject.includes(w)));
      if (related) {
        out.push({
          lesson: `"${p.subject}" has recurred ${p.occurrences}× and coincides with the decision "${related.decision}" — worth examining the link.`,
          basis: `${p.evidence} Decision on ${related.at}: ${related.evidence}.`,
          confidence: p.occurrences >= 4 ? "high" : "medium",
          sourceSubjects: [p.subject, related.decision],
        });
      } else {
        out.push({
          lesson: `"${p.subject}" is a reliable recurring ${p.kind} (${p.occurrences}× in ${Math.round(p.windowDays)}d) — treat it as a standing condition, not a one-off.`,
          basis: p.evidence,
          confidence: p.occurrences >= 4 ? "high" : "medium",
          sourceSubjects: [p.subject],
        });
      }
    }
  }
  return out.slice(0, LESSON_CAP);
}

function rankDecisions(snaps: MemorySnapshot[]): DecisionRecord[] {
  const all = snaps.flatMap((s) => s.decisions ?? []);
  // Dedupe by (decision, at); most recent first; cap.
  const seen = new Set<string>();
  const out: DecisionRecord[] = [];
  for (const d of [...all].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    const k = `${norm(d.decision)}|${d.at}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return out.slice(0, DECISION_CAP);
}

// ─── public entry point ──────────────────────────────────────────────────────

/**
 * Build the Executive Memory report from a supplied snapshot history. Pure +
 * deterministic. Honesty floor: with fewer than `minHistory` in-window snapshots, returns
 * status "insufficient_history" and empty lists — never fabricates patterns/trends/lessons.
 */
export function executiveMemory(history: MemorySnapshot[], opts: ExecutiveMemoryOptions): ExecutiveMemoryReport {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const minHistory = opts.minHistory ?? DEFAULT_MIN_HISTORY;
  const minOcc = opts.minOccurrences ?? DEFAULT_MIN_OCCURRENCES;

  const snaps = pruneSnapshots(history, opts.now, windowDays);

  if (snaps.length < minHistory) {
    return {
      status: "insufficient_history",
      recurringPatterns: [],
      trends: [],
      lessons: [],
      decisions: [],
      note: `INSUFFICIENT_HISTORY — ${snaps.length} in-window snapshot(s); need ≥ ${minHistory} before patterns/trends/lessons can be earned. No synthetic wisdom.`,
    };
  }

  const recurringPatterns = detectPatterns(snaps, opts.now, windowDays, minOcc);
  const trends = detectTrends(snaps, windowDays);
  const lessons = deriveLessons(recurringPatterns, snaps);
  const decisions = rankDecisions(snaps);

  const found = recurringPatterns.length + lessons.length;
  const note = found
    ? `${recurringPatterns.length} recurring pattern(s), ${trends.length} trend(s), ${lessons.length} lesson(s) from ${snaps.length} snapshot(s) over ${Math.round(windowDays)} days.`
    : `No recurring pattern crossed the threshold across ${snaps.length} snapshot(s) — nothing repeated enough to remember yet. That's an honest read, not amnesia.`;

  return { status: "ok", recurringPatterns, trends, lessons, decisions, note };
}

/** One-line, deterministic summary (for embedding / a panel header). */
export function summarizeMemory(m: ExecutiveMemoryReport): string {
  if (m.status === "insufficient_history") return "Executive memory: insufficient history.";
  return `Executive memory: ${m.recurringPatterns.length} pattern(s), ${m.trends.length} trend(s), ${m.lessons.length} lesson(s).`;
}

/**
 * Look up the historical context for a current finding subject — "ops stale occurred 4× in
 * the last 60 days". Returns null when the subject isn't a recurring pattern (honest: a
 * first-time finding has no history). Used by the Strategic Brief to annotate live risks.
 */
export function historicalContextFor(subject: string, memory: ExecutiveMemoryReport): string | null {
  if (memory.status !== "ok") return null;
  const key = norm(subject);
  const hit = memory.recurringPatterns.find((p) => key.includes(p.subject) || p.subject.includes(key));
  return hit ? hit.evidence : null;
}
