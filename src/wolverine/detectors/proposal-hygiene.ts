/**
 * src/wolverine/detectors/proposal-hygiene.ts
 *
 * Wolverine detector — proposal-queue hygiene. Pure (operates on stats the host gathered from
 * the spine). This is the first detector whose fixes ROUTE TO EXISTING GATED ADAPTERS:
 *   - aging draft proposals  → reject-drafts   (T0, internal, reversible)
 *   - rejected proposals      → archive-rejected (T0, internal, reversible)
 *
 * So these findings become real FixProposals that flow through the proven approve → execute →
 * audit spine — Wolverine proposes, Hart approves, the adapter mutates. Automatic eyes, gated hands.
 */

import type { WolverineFinding, WolverineInputs } from "../wolverine-types.js";

export const PROPOSAL_HYGIENE_DETECTOR = "proposal-hygiene";

export function detectProposalHygiene(inputs: WolverineInputs): WolverineFinding[] {
  const stats = inputs.proposalStats;
  if (!stats) return []; // not gathered ⇒ assess nothing (honest)
  const out: WolverineFinding[] = [];
  const agingHours = stats.agingHours ?? 72;

  const aging = stats.agingDraftCount ?? 0;
  if (aging > 0) {
    out.push({
      id: "proposal:aging-drafts",
      category: "improvement",
      severity: "medium",
      title: `${aging} aging draft proposal${aging === 1 ? "" : "s"} in the queue`,
      evidence: `${aging} draft/pending proposal(s) older than ${Math.round(agingHours)}h — the queue no longer reflects live intent; approving stale drafts later is riskier than clearing them now.`,
      ownerAgent: "HartOS proposal spine",
      recommendedFix: `Reject the ${aging} aging draft(s) via the gated reject-drafts adapter (you approve; then it mutates).`,
      blastRadius: "Internal proposal queue only — sets aging draft rows to 'rejected'. No external/provider write.",
      rollbackPath: "Reversible: restore a wrongly-rejected proposal's status to 'draft'.",
      approvalRequired: true,
      confidence: "high",
      freshness: "proposal spine, as of run",
      source: PROPOSAL_HYGIENE_DETECTOR,
      fixRoute: { adapterId: "reject-drafts", tier: "T0" },
    });
  }

  const rejected = stats.rejectedCount ?? 0;
  if (rejected > 0) {
    out.push({
      id: "proposal:rejected-to-archive",
      category: "improvement",
      severity: "low",
      title: `${rejected} rejected proposal${rejected === 1 ? "" : "s"} to archive`,
      evidence: `${rejected} rejected proposal(s) are cluttering the active queue — archiving keeps the queue readable.`,
      ownerAgent: "HartOS proposal spine",
      recommendedFix: `Archive the ${rejected} rejected proposal(s) via the gated archive-rejected adapter (you approve; then it mutates).`,
      blastRadius: "Internal proposal queue only — marks rejected rows archived. No external/provider write.",
      rollbackPath: "Reversible: un-archive a wrongly-archived proposal back to 'rejected'.",
      approvalRequired: true,
      confidence: "high",
      freshness: "proposal spine, as of run",
      source: PROPOSAL_HYGIENE_DETECTOR,
      fixRoute: { adapterId: "archive-rejected", tier: "T0" },
    });
  }

  return out;
}
