/**
 * src/learning/record-decision-outcomes.ts — the closed learning loop's WRITE half (shared).
 *
 * For each recently-EXECUTED proposal that targeted a finding, compare its TARGET SUBJECT against
 * the subjects still present in a LATER observation (currentSubjects, typically a fresh Wolverine
 * audit's repairQueue) and append ONE observation (resolved/persisted/unknown) to
 * public.cockpit_decision_outcomes. This is the EFFECT half executive-memory never had.
 *
 * ONE implementation, shared by BOTH callers (DRY):
 *   - scripts/hartos-autopilot.ts step 5c (the scheduled pulse), and
 *   - scripts/run-outcome-observer-pass.ts (the daemon sub-pass).
 *
 * Honest by construction: honest no-op when the (gated, possibly-not-yet-applied) outcomes table is
 * absent (42P01). Never fabricates rows; scoring is the pure, deterministic classifyExecutedOutcomes.
 * Throws are the caller's to isolate — callers wrap this so a failed learn never fails the pulse/daemon.
 */

import { classifyExecutedOutcomes, type ExecutedTarget, type ScoredOutcome } from "./outcome-scoring.js";

/** The minimal DB surface this needs — satisfied by ProposalDbHandle (createCockpitProposalDb). */
export interface OutcomesDb {
  query: (text: string, params?: unknown[]) => Promise<{ rowCount?: number | null; rows: unknown[] }>;
}

export interface RecordOutcomesResult {
  /** Rows actually INSERTed into cockpit_decision_outcomes. */
  written: number;
  /** Every proposal scored this pass (whether or not the table was present to receive it). */
  scored: ScoredOutcome[];
  /** True when the (gated) outcomes table is absent (42P01) — an honest no-op, not a failure. */
  tableMissing: boolean;
  /** A human-readable, honest one-line summary mirroring the prior autopilot 5c wording. */
  summary: string;
}

/** True for the "relation does not exist" family — the gated table not having been applied yet. */
function isTableMissing(message: string): boolean {
  return /cockpit_decision_outcomes|does not exist|42P01/i.test(message);
}

/**
 * Score recently-executed targeted proposals against the currently-present subjects and append the
 * verdicts. Selects status='executed' proposals updated in the last 14 days, derives each subject
 * from payload.targetId || payload.targetName, scores via classifyExecutedOutcomes, and INSERTs one
 * row per scored proposal. Honest no-op on 42P01 (table not applied). Returns counts + the summary.
 */
export async function recordDecisionOutcomes(
  db: OutcomesDb,
  currentSubjects: string[],
  // `now` is part of the signature for parity with the daemon-pass family + future observed_at use;
  // the table defaults observed_at to now() server-side, so it is intentionally not bound in the INSERT.
  _now: string,
): Promise<RecordOutcomesResult> {
  const res = await db.query(
    `select id, payload from public.cockpit_proposals where status='executed' and updated_at > now() - interval '14 days' order by updated_at desc limit 100`,
    [],
  );
  const rows = res.rows as Array<{ id: string; payload: unknown }>;
  const executed: ExecutedTarget[] = [];
  for (const r of rows) {
    const p = (r.payload && typeof r.payload === "object" ? r.payload : {}) as Record<string, unknown>;
    const subject =
      typeof p.targetId === "string" && p.targetId
        ? p.targetId
        : typeof p.targetName === "string"
          ? p.targetName
          : "";
    if (!subject) continue; // only finding-targeting proposals carry a measurable subject
    executed.push({ proposalId: r.id, actionType: typeof p.actionType === "string" ? p.actionType : "unknown", subject });
  }
  if (executed.length === 0) {
    return { written: 0, scored: [], tableMissing: false, summary: "no recently-executed targeted proposals to score" };
  }

  const scored = classifyExecutedOutcomes(executed, currentSubjects);
  let written = 0;
  try {
    for (const s of scored) {
      await db.query(
        `insert into public.cockpit_decision_outcomes (proposal_id, action_type, subject, outcome) values ($1,$2,$3,$4)`,
        [s.proposalId, s.actionType, s.subject, s.outcome],
      );
      written += 1;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isTableMissing(msg)) {
      return {
        written: 0,
        scored,
        tableMissing: true,
        summary: `outcomes table not present — apply 20260611011110_cockpit_decision_outcomes.sql (scored ${scored.length}, wrote 0)`,
      };
    }
    // Re-throw non-42P01 failures: the caller isolates them (a failed learn must not fail the pulse).
    throw e;
  }

  const resolved = scored.filter((s) => s.outcome === "resolved").length;
  const persisted = scored.filter((s) => s.outcome === "persisted").length;
  const unknown = scored.filter((s) => s.outcome === "unknown").length;
  const tally = `${resolved} resolved · ${persisted} persisted${unknown ? ` · ${unknown} unknown` : ""}`;
  return {
    written,
    scored,
    tableMissing: false,
    summary: `scored ${scored.length} executed proposal(s): ${tally} (wrote ${written})`,
  };
}
