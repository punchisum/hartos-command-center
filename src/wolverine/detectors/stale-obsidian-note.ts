/**
 * src/wolverine/detectors/stale-obsidian-note.ts
 *
 * Wolverine detector — Obsidian vault hygiene (this is "Wolverine audits Obsidian"). Pure
 * (operates on vault note metadata the host gathered). It keeps the meaning layer trustworthy so
 * the Rinnegan context compiler never feeds a stale note into reasoning:
 *   - a note past its `review_by` date  → overdue review (medium)
 *   - an old note with no review date    → set a cadence (low)
 * Aggregated (≤2 findings, with examples) so a big vault doesn't produce a wall of noise.
 */

import type { WolverineFinding, WolverineInputs } from "../wolverine-types.js";

export const STALE_OBSIDIAN_NOTE_DETECTOR = "stale-obsidian-note";

/** Notes older than this (days) with no review_by are flagged to set a cadence. */
const VERY_OLD_DAYS = 180;

function sample(rels: string[]): string {
  return rels.slice(0, 3).join(", ") + (rels.length > 3 ? ", …" : "");
}

export function detectStaleObsidianNote(inputs: WolverineInputs): WolverineFinding[] {
  const notes = inputs.vaultNotes ?? [];
  if (notes.length === 0) return [];
  const nowMs = Date.parse(inputs.now);

  const overdue = notes.filter(
    (n) => n.reviewBy && Number.isFinite(Date.parse(n.reviewBy)) && Date.parse(n.reviewBy) < nowMs,
  );
  const veryOld = notes.filter((n) => !n.reviewBy && n.ageDays != null && n.ageDays > VERY_OLD_DAYS);

  const out: WolverineFinding[] = [];
  if (overdue.length) {
    out.push({
      id: "stale-obsidian:overdue-review",
      category: "stale_data",
      severity: "medium",
      title: `${overdue.length} vault note(s) past their review date`,
      evidence: `Notes with review_by in the past: ${sample(overdue.map((n) => n.relPath))}. The meaning layer may no longer match reality.`,
      ownerAgent: "Obsidian vault",
      recommendedFix: "Review + refresh each, then bump review_by (or archive if obsolete).",
      blastRadius: "Vault meaning layer — affects what Rinnegan compiles into reasoning context.",
      rollbackPath: "n/a — review only.",
      approvalRequired: false,
      confidence: "high",
      freshness: "vault scan, as of run",
      source: STALE_OBSIDIAN_NOTE_DETECTOR,
    });
  }
  if (veryOld.length) {
    out.push({
      id: "stale-obsidian:very-old",
      category: "stale_data",
      severity: "low",
      title: `${veryOld.length} vault note(s) over ${VERY_OLD_DAYS}d old with no review date`,
      evidence: `Old notes with no review_by: ${sample(veryOld.map((n) => n.relPath))}. Without a review cadence, the vault rots silently.`,
      ownerAgent: "Obsidian vault",
      recommendedFix: "Add a review_by date (or confirm still-current) so stale notes age out visibly.",
      blastRadius: "Vault meaning layer.",
      rollbackPath: "n/a.",
      approvalRequired: false,
      confidence: "medium",
      freshness: "vault scan, as of run",
      source: STALE_OBSIDIAN_NOTE_DETECTOR,
    });
  }
  return out;
}
