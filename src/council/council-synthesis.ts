/**
 * P7 Council — synthesis core.
 *
 * DOCTRINE §19 (no laundering): synthesized confidence NEVER exceeds the
 * WEAKEST non-degraded finding's confidence band.  Degraded findings are
 * excluded from the confidence computation but surfaced in notes.  Dissent
 * (low-confidence or risk-flagging specialists) is surfaced, never averaged
 * away.  PURE — never throws.
 */

import type { Confidence, SpecialistFinding, Synthesis } from "./council-types.js";

/** Ordinal rank for each band (lower = weaker). */
const BAND_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const RANK_BAND: Confidence[] = ["low", "medium", "high"];

/**
 * Fuse specialist findings into a single `Synthesis`.
 *
 * @param findings  All specialist findings for this council node.
 * @param opts.truncated  Whether the panel was capped by a token/count limit.
 */
export function synthesize(
  findings: SpecialistFinding[],
  opts: { truncated: boolean },
): Synthesis {
  const live = findings.filter((x) => !x.degraded);
  const degraded = findings.filter((x) => x.degraded);

  // ── Confidence (no laundering) ────────────────────────────────────────────
  // Take the MINIMUM band rank across all non-degraded findings.
  // If live is empty, floor to "low" — we have nothing to anchor to.
  let confidence: Confidence = "low";
  if (live.length > 0) {
    const minRank = live.reduce<number>(
      (min, f) => Math.min(min, BAND_RANK[f.confidence]),
      BAND_RANK["high"],
    );
    confidence = RANK_BAND[minRank];
  }

  // ── Consensus ─────────────────────────────────────────────────────────────
  // One line per non-degraded specialist: "specialistId: summary"
  const consensus: string[] = live.map((f) => `${f.specialistId}: ${f.summary}`);

  // ── Dissent ───────────────────────────────────────────────────────────────
  // Surface low-confidence findings OR any finding with risks.
  const dissent: string[] = live
    .filter((f) => f.confidence === "low" || f.risks.length > 0)
    .map((f) => `${f.specialistId}: ${f.risks.length > 0 ? f.risks.join("; ") : "low confidence"}`);

  // ── Notes (honest gaps) ───────────────────────────────────────────────────
  const notes: string[] = [];

  // Degraded specialists are noted by name so reviewers know who was missing.
  for (const f of degraded) {
    notes.push(`${f.specialistId} degraded — no usable finding`);
  }

  // If nothing usable at all, make the floor explicit.
  if (live.length === 0) {
    notes.push("no non-degraded specialist findings — confidence floored to low");
  }

  // Truncation is a data-quality gap that readers need to know about.
  if (opts.truncated) {
    notes.push("panel truncated by caps — synthesized from partial input");
  }

  // ── Recommendation ────────────────────────────────────────────────────────
  // Deterministic roll-up string — no LLM call here (that is a later plan).
  const recommendation =
    `Council reviewed by ${live.length} specialist(s); overall confidence ${confidence}. ` +
    (consensus.length > 0 ? consensus.join(" | ") : "no findings");

  return {
    recommendation,
    confidence,
    consensus,
    dissent,
    truncated: opts.truncated,
    notes,
  };
}
