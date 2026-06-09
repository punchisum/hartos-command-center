/**
 * src/fitness/coaching-core.ts
 *
 * Depth upgrade for the Fitness coach — a deterministic COACHING core in the
 * Phase A/B / research-planner style, replacing the single-field if/else the panel
 * used to ship (recovery present? → one templated string).
 *
 * It cross-reasons over the signals whose meaning is UNAMBIGUOUS — recovery band ×
 * planned-session intensity × whether today's session is already done — to produce a
 * structured readiness verdict with the specific drivers that caused it, grounded
 * modifiers, an honest confidence that rises with data completeness, and an explicit
 * list of what it could not see. It is scrupulous about NOT fabricating: unit-
 * ambiguous numbers (weekly load with no unit; calories-so-far with no time-of-day)
 * are surfaced as CONTEXT, never used to manufacture a readiness inference. Pure +
 * deterministic: same signals → same advice. An LLM may later narrate it; the
 * decision is computed here.
 */

import type { SourceResult } from "../cockpit/sources/source-types.js";

export type RecoveryBand = "high" | "moderate" | "low" | "unknown";
export type PlanIntensity = "rest" | "easy" | "hard" | "unknown";
export type CoachingVerdict = "train_as_planned" | "train_modified" | "prioritize_recovery" | "insufficient_data";
export type CoachingConfidence = "high" | "medium" | "low";

export interface CoachingSignals {
  /** Recovery as a 0–100 readiness score, if the source gave a numeric one. */
  recoveryScore?: number;
  /** Raw recovery label (e.g. "green"/"low") when not numeric. */
  recoveryLabel?: string;
  /** Today's calories consumed so far / target (partial-day; context only). */
  caloriesHave?: number;
  caloriesTarget?: number;
  proteinHave?: number;
  proteinTarget?: number;
  /** Raw weekly-load string — unit-ambiguous, surfaced as context, never thresholded. */
  weeklyLoadRaw?: string;
  /** Bodyweight direction over the recent series — context (e.g. cut/bulk), not a readiness signal. */
  bodyweightTrend?: "rising" | "falling" | "flat";
  /** Today's planned session, free text. */
  trainingPlan?: string;
  /** Whether today's session is already logged. */
  trainingCompleted?: boolean;
}

export interface CoachingAdvice {
  verdict: CoachingVerdict;
  recoveryBand: RecoveryBand;
  planIntensity: PlanIntensity;
  /** One-line headline recommendation. */
  headline: string;
  /** The specific signals that drove the verdict — grounded in real values, never invented. */
  drivers: string[];
  /** Secondary, grounded adjustments / context (fuel, load) — not verdict-changing claims. */
  modifiers: string[];
  /** What the coach could NOT see (named, not guessed at). */
  unknowns: string[];
  confidence: CoachingConfidence;
  /** Deterministic, fact-based explanation of the verdict. */
  reason: string;
  /**
   * The single most important DOWNSIDE to manage today (injury/overtraining/under-fuel),
   * derived from the signal mismatch — null when nothing concrete is at risk.
   */
  risk: string | null;
  /**
   * The single best UPSIDE to capture today (capacity to push, an easy recovery win) —
   * null when there's no grounded opportunity. Never fabricated.
   */
  opportunity: string | null;
}

// Conventional readiness bands (e.g. WHOOP-style recovery %). Labeled + tunable —
// these are the ONLY numeric thresholds the core uses, and only on a value (recovery
// score) whose 0–100 semantics are unambiguous.
const RECOVERY_HIGH = 67;
const RECOVERY_LOW = 34;

const HIGH_WORDS = /\b(green|high|good|great|optimal|ready|recovered)\b/i;
const MID_WORDS = /\b(amber|yellow|moderate|medium|ok|okay|fair|maintain)\b/i;
const LOW_WORDS = /\b(red|low|poor|bad|under|fatigued|tired|strain(ed)?)\b/i;

const HARD_PLAN = /\b(hard|intense|interval|threshold|tempo|vo2|race|long run|heavy|max|pr|pb|hiit|sprint)\b/i;
const EASY_PLAN = /\b(easy|recovery|light|mobility|zone\s?2|z2|walk|shakeout|active recovery|stretch|yoga)\b/i;
const REST_PLAN = /\b(rest|off|day off|no training|deload)\b/i;

function recoveryBandOf(s: CoachingSignals): RecoveryBand {
  if (typeof s.recoveryScore === "number" && Number.isFinite(s.recoveryScore)) {
    return s.recoveryScore >= RECOVERY_HIGH ? "high" : s.recoveryScore >= RECOVERY_LOW ? "moderate" : "low";
  }
  const label = s.recoveryLabel?.trim();
  if (label) {
    if (LOW_WORDS.test(label)) return "low";
    if (HIGH_WORDS.test(label)) return "high";
    if (MID_WORDS.test(label)) return "moderate";
  }
  return "unknown";
}

function planIntensityOf(plan: string | undefined): PlanIntensity {
  if (!plan || !plan.trim()) return "unknown";
  if (REST_PLAN.test(plan)) return "rest";
  if (HARD_PLAN.test(plan)) return "hard";
  if (EASY_PLAN.test(plan)) return "easy";
  return "unknown";
}

function recoveryDriver(band: RecoveryBand, s: CoachingSignals): string {
  if (typeof s.recoveryScore === "number") return `Recovery ${s.recoveryScore} → ${band} band.`;
  if (s.recoveryLabel) return `Recovery "${s.recoveryLabel}" → ${band} band.`;
  return "Recovery readiness not available.";
}

/**
 * Compute coaching advice from the signals. Deterministic. Every driver/modifier is
 * grounded in a supplied value; nothing is fabricated, and ambiguous numbers are
 * reported as context rather than turned into a readiness claim.
 */
export function coach(signals: CoachingSignals): CoachingAdvice {
  const band = recoveryBandOf(signals);
  const plan = planIntensityOf(signals.trainingPlan);
  const drivers: string[] = [];
  const modifiers: string[] = [];
  const unknowns: string[] = [];

  // ── Already trained today → the live decision is recovery, not whether to train ──
  if (signals.trainingCompleted === true) {
    drivers.push("Today's session is already logged.");
    addContext(signals, modifiers);
    const r = band !== "unknown" ? ` Recovery reads ${band}.` : "";
    return finalize(signals, {
      verdict: "prioritize_recovery",
      band,
      plan,
      headline: "Today's session is done — shift to refuel and recovery.",
      drivers,
      modifiers,
      unknowns: namedUnknowns(signals, band, plan),
      reason: `Training completed → the remaining-day priority is recovery + nutrition.${r}`,
    });
  }

  // ── Recovery is the keystone signal; cross-reason it with the planned intensity ──
  let verdict: CoachingVerdict;
  let headline: string;
  drivers.push(recoveryDriver(band, signals));

  if (band === "low") {
    verdict = "prioritize_recovery";
    headline = plan === "hard"
      ? "Recovery is low and a hard session is planned — swap it for rest or light mobility."
      : "Recovery is low — keep today easy or take it off.";
    if (plan === "hard") drivers.push("A hard session is planned against low recovery — the mismatch is the risk.");
  } else if (band === "moderate") {
    if (plan === "hard") {
      verdict = "train_modified";
      headline = "Recovery is moderate — cap the hard session (cut volume/intensity ~20–30%).";
      drivers.push("Hard plan on moderate recovery → modify rather than skip.");
    } else {
      verdict = "train_as_planned";
      headline = plan === "rest" || plan === "easy"
        ? "Recovery is moderate and your easy/rest plan fits — proceed."
        : "Recovery is moderate — proceed, but hold something back on the hard efforts.";
    }
  } else if (band === "high") {
    verdict = "train_as_planned";
    headline = plan === "hard"
      ? "Recovery is high — green light for the planned hard session."
      : "Recovery is high — proceed; you have capacity for more if you want it.";
    if (plan === "rest" || plan === "easy") modifiers.push("Recovery is high — there's room to add load if you feel good.");
  } else {
    // Recovery unknown — don't fabricate readiness; default conservative if there's a plan.
    if (plan !== "unknown") {
      verdict = "train_modified";
      headline = "Recovery isn't available — default to a conservative version of today's plan.";
      drivers.push("No recovery reading → defaulting to conservative until it's surfaced.");
    } else {
      verdict = "insufficient_data";
      headline = "Not enough signal to coach today — surface recovery and today's plan.";
    }
  }

  addContext(signals, modifiers);

  return finalize(signals, {
    verdict,
    band,
    plan,
    headline,
    drivers,
    modifiers,
    unknowns: namedUnknowns(signals, band, plan),
    reason: reasonFor(verdict, band, plan),
  });
}

/** Surface grounded, non-verdict context (fuel so far, weekly load) — clearly partial. */
function addContext(s: CoachingSignals, modifiers: string[]): void {
  if (typeof s.caloriesHave === "number") {
    const t = typeof s.caloriesTarget === "number" ? ` / ${s.caloriesTarget} target` : "";
    modifiers.push(`Fuel so far today: ${s.caloriesHave} kcal${t} (partial-day — not a readiness signal).`);
  }
  if (typeof s.proteinHave === "number") {
    const t = typeof s.proteinTarget === "number" ? ` / ${s.proteinTarget}g target` : "";
    modifiers.push(`Protein so far: ${s.proteinHave}g${t} — keep it on pace for recovery.`);
  }
  if (s.weeklyLoadRaw && s.weeklyLoadRaw.trim()) {
    modifiers.push(`Weekly load context: ${s.weeklyLoadRaw.trim()} (unit-ambiguous — informational).`);
  }
  if (s.bodyweightTrend) {
    modifiers.push(`Bodyweight is ${s.bodyweightTrend} over the recent series (context — not today's readiness).`);
  }
}

function namedUnknowns(s: CoachingSignals, band: RecoveryBand, plan: PlanIntensity): string[] {
  const u: string[] = [];
  if (band === "unknown") u.push("recovery readiness");
  if (plan === "unknown") u.push("today's training plan");
  if (s.trainingCompleted === undefined) u.push("whether today's session is done");
  if (s.caloriesHave === undefined && s.proteinHave === undefined) u.push("nutrition");
  if (!s.weeklyLoadRaw) u.push("weekly load");
  return u;
}

function reasonFor(verdict: CoachingVerdict, band: RecoveryBand, plan: PlanIntensity): string {
  const p = plan === "unknown" ? "no plan surfaced" : `a ${plan} session planned`;
  switch (verdict) {
    case "train_as_planned": return `${cap(band)} recovery with ${p} → proceed as planned.`;
    case "train_modified": return `${cap(band)} recovery with ${p} → train, but scale it back.`;
    case "prioritize_recovery": return `${cap(band)} recovery with ${p} → recovery comes first today.`;
    case "insufficient_data": return "Too few signals (no recovery, no plan) to give a grounded recommendation.";
  }
}

/**
 * The single most important downside to manage today. Grounded in the signal mismatch —
 * never a generic "be careful". Null when nothing concrete is at risk.
 */
function riskOf(s: CoachingSignals, band: RecoveryBand, plan: PlanIntensity): string | null {
  // The classic injury/overtraining trap: a hard session stacked on poor recovery.
  if (band === "low" && plan === "hard") {
    return "Hard session planned on low recovery — pushing it risks injury and digs the fatigue hole deeper. This is the day to back off.";
  }
  if (band === "moderate" && plan === "hard") {
    return "Hard session on moderate recovery — going full-send risks turning a quality day into accumulated fatigue. Cap intensity, don't chase PRs.";
  }
  if (band === "low" && plan !== "rest" && plan !== "unknown") {
    return "Recovery is low — even a normal session adds strain you can't currently absorb. Keep it genuinely easy.";
  }
  // Under-fuelling signal: losing weight while recovery is suppressed.
  if (s.bodyweightTrend === "falling" && band === "low") {
    return "Bodyweight falling while recovery is low — likely under-fuelled. Protect recovery before adding training stress.";
  }
  // Blind flying: no recovery reading against a planned session.
  if (band === "unknown" && (plan === "hard" || plan === "easy")) {
    return "No recovery reading before a planned session — you're training blind. Sync the wearable before deciding intensity.";
  }
  return null;
}

/**
 * The single best upside to capture today. Grounded — only surfaced when the data
 * actually supports it. Null when there's no real opportunity.
 */
function opportunityOf(s: CoachingSignals, band: RecoveryBand, plan: PlanIntensity): string | null {
  // High recovery against a light/rest day → unused capacity worth spending.
  if (band === "high" && (plan === "easy" || plan === "rest")) {
    return "Recovery is high but the plan is light — you have capacity to add quality (extra interval, longer effort) if the schedule allows.";
  }
  if (band === "high" && plan === "hard") {
    return "Recovery is high and a hard session is on — this is a green-light day to make it count and bank a real quality stimulus.";
  }
  // Cheap recovery win: protein behind target is a controllable lever.
  if (typeof s.proteinHave === "number" && typeof s.proteinTarget === "number" && s.proteinHave < s.proteinTarget * 0.7) {
    const gap = Math.round(s.proteinTarget - s.proteinHave);
    return `Protein is ~${gap}g behind target — closing it today is the cheapest available win for recovery and adaptation.`;
  }
  return null;
}

function confidenceOf(s: CoachingSignals, band: RecoveryBand, plan: PlanIntensity): CoachingConfidence {
  if (band === "unknown") return "low";
  const corroborating = [
    plan !== "unknown",
    s.trainingCompleted !== undefined,
    s.caloriesHave !== undefined || s.proteinHave !== undefined,
    !!s.weeklyLoadRaw,
  ].filter(Boolean).length;
  return corroborating >= 3 ? "high" : corroborating >= 1 ? "medium" : "low";
}

function finalize(signals: CoachingSignals, p: {
  verdict: CoachingVerdict; band: RecoveryBand; plan: PlanIntensity; headline: string;
  drivers: string[]; modifiers: string[]; unknowns: string[]; reason: string;
}): CoachingAdvice {
  return {
    verdict: p.verdict,
    recoveryBand: p.band,
    planIntensity: p.plan,
    headline: p.headline,
    drivers: p.drivers,
    modifiers: p.modifiers,
    unknowns: p.unknowns,
    confidence: confidenceOf(signals, p.band, p.plan),
    reason: p.reason,
    risk: riskOf(signals, p.band, p.plan),
    opportunity: opportunityOf(signals, p.band, p.plan),
  };
}

function cap(s: string): string {
  return s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s;
}

/** One-line, deterministic summary of coaching advice (for embedding / the panel). */
export function summarizeAdvice(a: CoachingAdvice): string {
  const v = a.verdict.replace(/_/g, " ");
  return `Coach: ${v} (${a.recoveryBand} recovery, ${a.confidence} confidence).`;
}

function num(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const m = raw.match(/-?\d+(\.\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : undefined;
}
/** Parse a "have / target" pair (e.g. "1800 / 2200"); falls back to a lone number as `have`. */
function pair(raw: string | undefined): { have?: number; target?: number } {
  if (raw == null) return {};
  const m = raw.match(/([\d.]+)\s*\/\s*([\d.]+)/);
  if (m) {
    const have = Number(m[1]); const target = Number(m[2]);
    return { ...(Number.isFinite(have) ? { have } : {}), ...(Number.isFinite(target) ? { target } : {}) };
  }
  const single = num(raw);
  return single != null ? { have: single } : {};
}
function bool(raw: string | undefined): boolean | undefined {
  if (raw == null) return undefined;
  if (/^\s*(true|yes|done|complete|completed|1|y)\s*$/i.test(raw)) return true;
  if (/^\s*(false|no|not|incomplete|0|n|pending)\s*$/i.test(raw)) return false;
  return undefined;
}

/**
 * Adapt a resolved Fitness SourceResult into coaching signals. Pure: it only parses
 * already-resolved values (never fetches), and a numeric recovery is kept as a score
 * while any recovery string is also kept as a label so qualitative states still map.
 */
export function signalsFromSource(src: SourceResult): CoachingSignals {
  const recoveryRaw = src.values["recovery"]?.value;
  const cal = pair(src.values["calories"]?.value);
  const pro = pair(src.values["protein"]?.value);
  const completed = bool(src.values["training_completed"]?.value);
  const weekly = src.values["weekly_load"]?.value;
  const plan = src.values["training_plan"]?.value;
  const recScore = recoveryRaw && /^\s*\d+(\.\d+)?\s*%?\s*$/.test(recoveryRaw) ? num(recoveryRaw) : undefined;
  return {
    ...(recScore != null ? { recoveryScore: recScore } : {}),
    ...(recoveryRaw ? { recoveryLabel: recoveryRaw } : {}),
    ...(cal.have != null ? { caloriesHave: cal.have } : {}),
    ...(cal.target != null ? { caloriesTarget: cal.target } : {}),
    ...(pro.have != null ? { proteinHave: pro.have } : {}),
    ...(pro.target != null ? { proteinTarget: pro.target } : {}),
    ...(weekly ? { weeklyLoadRaw: weekly } : {}),
    ...(plan ? { trainingPlan: plan } : {}),
    ...(completed !== undefined ? { trainingCompleted: completed } : {}),
  };
}
