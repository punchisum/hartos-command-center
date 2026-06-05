/**
 * src/cockpit/control-surface/verdict-rules.ts
 *
 * Phase 18E — the deterministic rules. Everything that looks like a judgment of
 * *truth or trust* is computed here, from facts, BEFORE the LLM is called. The LLM
 * never sets verdict, confidence, or severity — it explains the ones we computed.
 *
 * Pure: no I/O, no network, no clock except the `now` you pass in.
 */

import type {
  Confidence,
  Fact,
  FixRecommendation,
  FixSeverity,
  Freshness,
  HealthCheck,
  Verdict,
} from "./fact-bundle.js";

/** Fresh window: younger than this is "fresh". */
export const FRESH_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h
/** Dead window: older than this (or a failed check) is "dead". */
export const DEAD_MIN_AGE_MS = 72 * 60 * 60 * 1000; // 72h

/**
 * Compute a datum's freshness from its timestamp vs now.
 *   value null            → "unknown"  (missing means missing)
 *   checkFailed           → "dead"     (a failed probe is not stale, it's dead)
 *   age < 6h              → "fresh"
 *   6h ≤ age ≤ 72h        → "stale"
 *   age > 72h             → "dead"
 * A future-stamped datum is treated as fresh (clock skew, never a lie about age).
 */
export function computeFreshness(
  asOf: string | null,
  now: string,
  opts: { valueNull?: boolean; checkFailed?: boolean } = {}
): Freshness {
  if (opts.valueNull) return "unknown";
  if (opts.checkFailed) return "dead";
  if (!asOf) return "unknown";
  const t = Date.parse(asOf);
  const n = Date.parse(now);
  if (Number.isNaN(t) || Number.isNaN(n)) return "unknown";
  if (t > n) return "fresh";
  const age = n - t;
  if (age < FRESH_MAX_AGE_MS) return "fresh";
  if (age > DEAD_MIN_AGE_MS) return "dead";
  return "stale";
}

const FRESHNESS_RANK: Record<Freshness, number> = { fresh: 0, stale: 1, dead: 2, unknown: 3 };

/** Worst (highest-rank) freshness across a set of facts. Empty → "unknown". */
export function worstFreshness(facts: Fact[]): Freshness {
  if (facts.length === 0) return "unknown";
  let worst: Freshness = "fresh";
  for (const f of facts) {
    if (FRESHNESS_RANK[f.freshness] > FRESHNESS_RANK[worst]) worst = f.freshness;
  }
  return worst;
}

/** True when the bundle could not be fetched at all (no facts, or every value null). */
export function isUnavailable(facts: Fact[]): boolean {
  if (facts.length === 0) return true;
  return facts.every((f) => f.value === null);
}

/**
 * VERDICT — computed over facts + health.
 *   UNKNOWN if the bundle could not be fetched (facts all null/empty)
 *   RED     if any health state === "r" OR a safety-critical fact is "dead"
 *   AMBER   if any fact freshness === "stale" OR a blocking condition exists
 *   GREEN   if all facts "fresh" AND no blockers
 *
 * `safetyCriticalKeys` are the fact keys whose deadness must escalate to RED.
 * `blocked` is a deterministic blocking condition (e.g. a blocked Ops card).
 */
export function computeVerdict(
  facts: Fact[],
  health: HealthCheck[],
  opts: { safetyCriticalKeys?: string[]; blocked?: boolean } = {}
): Verdict {
  if (isUnavailable(facts)) return "UNKNOWN";

  const safety = new Set(opts.safetyCriticalKeys ?? []);
  const anyHealthRed = health.some((h) => h.state === "r");
  const safetyDead = facts.some((f) => safety.has(f.key) && f.freshness === "dead");
  if (anyHealthRed || safetyDead) return "RED";

  const anyStaleOrDead = facts.some((f) => f.freshness === "stale" || f.freshness === "dead");
  if (anyStaleOrDead || opts.blocked) return "AMBER";

  return "GREEN";
}

/**
 * CONFIDENCE = worst freshness among the facts (the ones the verdict was computed
 * over). The LLM cannot assert it; we compute it.
 *   HIGH    all facts "fresh"
 *   LOW     any fact "stale" or "dead"
 *   UNKNOWN any fact "unknown"/null
 */
export function computeConfidence(facts: Fact[]): Confidence {
  const worst = worstFreshness(facts);
  switch (worst) {
    case "fresh":
      return "HIGH";
    case "stale":
    case "dead":
      return "LOW";
    case "unknown":
    default:
      return "UNKNOWN";
  }
}

/** Severity ranking, highest first. A `security` item can never sort below a `note`. */
export const SEVERITY_RANK: Record<FixSeverity, number> = {
  security: 0,
  "stale-revenue": 1,
  blocked: 2,
  next: 3,
  note: 4,
};

/**
 * Stable sort of fixes by COMPUTED severity (highest first). The LLM only orders
 * within a tier — ties preserve the input order, so the caller's intra-tier order
 * survives while cross-tier order is always rule-enforced.
 */
export function sortFixesBySeverity(fixes: FixRecommendation[]): FixRecommendation[] {
  return fixes
    .map((fix, index) => ({ fix, index }))
    .sort((a, b) => {
      const byTier = SEVERITY_RANK[a.fix.severity] - SEVERITY_RANK[b.fix.severity];
      return byTier !== 0 ? byTier : a.index - b.index;
    })
    .map((x) => x.fix);
}

/** The allowed, non-executable fix action kinds. There is intentionally no "execute". */
export const ALLOWED_FIX_ACTION_KINDS = ["copy_cli", "open_proposal", "open_link"] as const;

/** Guard: true when an action kind is one of the three non-executable kinds. */
export function isAllowedFixAction(kind: string): boolean {
  return (ALLOWED_FIX_ACTION_KINDS as readonly string[]).includes(kind);
}

/**
 * The computed SYSTEM verdict is the worst agent verdict. UNKNOWN is treated as
 * worse than GREEN but not as a hard failure — a missing bundle is honestly
 * unknown, not red. Order: RED > AMBER > UNKNOWN > GREEN.
 */
export function computeSystemVerdict(verdicts: Verdict[]): Verdict {
  if (verdicts.length === 0) return "UNKNOWN";
  const rank: Record<Verdict, number> = { RED: 0, AMBER: 1, UNKNOWN: 2, GREEN: 3 };
  let worst: Verdict = "GREEN";
  for (const v of verdicts) {
    if (rank[v] < rank[worst]) worst = v;
  }
  return worst;
}
