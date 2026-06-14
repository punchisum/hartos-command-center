/**
 * src/cockpit/panels/council-panel.ts
 *
 * P7 Plan 3 — Cockpit Council Panel builder. Pure function of injected proposals.
 *
 * Given a list of ActionProposals whose domain is "council" (each carrying a
 * CouncilProposalPayload in proposedPayload), produces:
 *   - a list-level summary of all council proposals
 *   - the selected proposal's full view-model (via councilViewModel)
 *   - the approve/reject affordances that REUSE the existing proposal-transition gate
 *
 * READ-ONLY. No execution. No network. No mutation. The approve/reject affordance
 * describes the existing POST /api/proposals/transition endpoint — the panel itself
 * never fires it.
 */

import type { ActionProposal } from "../proposals/proposal-types.js";
import { councilViewModel, councilViewSummary } from "../council-view.js";
import type { CouncilViewModel } from "../council-view.js";

/** Summarised row for the council proposal list. */
export interface CouncilProposalRow {
  id: string;
  title: string;
  status: string;
  riskLevel: string;
  createdAt: string;
  summary: string;
  /** True when this is the selected proposal displayed in full. */
  selected: boolean;
}

/**
 * The approve/reject affordance — describes how to use the EXISTING gate.
 * The panel surfaces these; it never calls them.
 */
export interface CouncilApprovalAffordance {
  /** The proposal id that would be approved/rejected. */
  proposalId: string;
  /** POST endpoint that handles approve/reject (existing gate). */
  endpoint: "POST /api/proposals/transition";
  /** Allowed action values. */
  actions: ["approve", "reject"];
  /** The gating note (always present — action execution is disabled in the Worker). */
  gatingNote: string;
}

/** Full panel data for the council proposals view. */
export interface CouncilPanelData {
  /** All council proposals as list rows. */
  proposals: CouncilProposalRow[];
  /** The total count of council proposals. */
  totalCount: number;
  /**
   * The selected proposal's full view-model (the first pending_approval proposal, or
   * the first proposal overall, or null when the list is empty).
   */
  selectedView: CouncilViewModel | null;
  /** The selected proposal's id (null when nothing is selected). */
  selectedId: string | null;
  /** The approve/reject affordance for the selected proposal (null when nothing selectable). */
  approvalAffordance: CouncilApprovalAffordance | null;
  /** Human-readable panel summary. */
  summary: string;
  generatedAt: string;
}

/**
 * True when a proposal is in a state where Hart can approve or reject it.
 * Mirrors the existing proposal-transition semantics: only non-terminal, non-expired.
 */
function isTransitionable(status: string): boolean {
  return status === "draft" || status === "pending_approval";
}

/**
 * Extract the CouncilProposalPayload from a proposal's proposedPayload field.
 * Returns null when absent or malformed.
 */
function extractCouncilPayload(proposal: ActionProposal): unknown | null {
  const pp = proposal.proposedPayload;
  if (pp === null || pp === undefined || typeof pp !== "object") return null;
  // The coordinator embeds the payload directly; tolerate both a nested `.councilPayload`
  // key and the payload being the top-level proposedPayload itself.
  const ppObj = pp as Record<string, unknown>;
  if ("rootGoal" in ppObj) return pp;
  if ("councilPayload" in ppObj && ppObj["councilPayload"]) return ppObj["councilPayload"];
  return null;
}

/**
 * Build the Council panel from an injected list of council proposals.
 * Pure. Tolerates an empty list. Never throws.
 */
export function buildCouncilPanel(
  proposals: ActionProposal[],
  opts: { selectedId?: string; now?: string } = {}
): CouncilPanelData {
  const now = opts.now ?? new Date().toISOString();

  // Filter to council domain proposals only (defensive — callers may pass a mixed list).
  const council = proposals.filter((p) => p.domain === "council");

  if (council.length === 0) {
    return {
      proposals: [],
      totalCount: 0,
      selectedView: null,
      selectedId: null,
      approvalAffordance: null,
      summary: "No council proposals yet. A council run will surface proposals here when armed.",
      generatedAt: now,
    };
  }

  // Select: explicit id → first pending_approval → first proposal.
  const selected: ActionProposal | undefined =
    (opts.selectedId ? council.find((p) => p.id === opts.selectedId) : undefined) ??
    council.find((p) => isTransitionable(p.status)) ??
    council[0]!;

  // Build the selected view-model.
  const selectedPayload = selected ? extractCouncilPayload(selected) : null;
  const selectedView = selected
    ? councilViewModel(selectedPayload)
    : null;

  // Build list rows.
  const rows: CouncilProposalRow[] = council.map((p) => {
    const payload = extractCouncilPayload(p);
    const vm = councilViewModel(payload);
    return {
      id: p.id,
      title: p.title,
      status: p.status,
      riskLevel: p.riskLevel,
      createdAt: p.createdAt,
      summary: councilViewSummary(vm),
      selected: selected ? p.id === selected.id : false,
    };
  });

  // Approval affordance — only when the selected proposal is transitionable.
  const affordance: CouncilApprovalAffordance | null =
    selected && isTransitionable(selected.status)
      ? {
          proposalId: selected.id,
          endpoint: "POST /api/proposals/transition",
          actions: ["approve", "reject"],
          gatingNote:
            "Action execution is disabled in the Worker (actionExecution: disabled). " +
            "POST { id, action: 'approve'|'reject' } to /api/proposals/transition to " +
            "advance the proposal status via the existing capability-token gate.",
        }
      : null;

  // Panel summary.
  const pendingCount = council.filter((p) => isTransitionable(p.status)).length;
  const summary =
    pendingCount > 0
      ? `${council.length} council proposal(s); ${pendingCount} awaiting Hart's decision. ` +
        (selectedView && !selectedView.degraded
          ? `Selected: ${councilViewSummary(selectedView)}`
          : "Selected proposal: (no data)")
      : `${council.length} council proposal(s); none pending approval.`;

  return {
    proposals: rows,
    totalCount: council.length,
    selectedView,
    selectedId: selected ? selected.id : null,
    approvalAffordance: affordance,
    summary,
    generatedAt: now,
  };
}
