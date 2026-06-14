/**
 * src/wolverine/sentinel-wolverine-bridge.ts
 *
 * Sentinel → Wolverine auto-engagement. When Sentinel's liveness read-model marks an
 * expected-live agent as down/stale, Wolverine is automatically engaged: it raises an
 * ADVISORY, propose-only FixProposal into the cockpit queue so the degradation is tracked
 * and actionable — instead of only pinging Hart on Telegram.
 *
 * Honest by design: a "down agent" has no adapter-routed automatic repair, so this is
 * advisory (executable:false, requiredApproval:"Hart"). "Automatic eyes, gated hands" —
 * Wolverine detects + proposes, it never restarts an agent on its own.
 *
 * PURE: `sentinelWolverineProposals` is a deterministic function of (fleet, now). The id is
 * stable per (agentId, state), so re-running upserts the same row — idempotent, no duplicates.
 */
import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
import type { FleetLiveness, LivenessVerdict } from "../sentinel/sentinel-liveness.js";

/** Only expected-live agents that are actually down/stale (mirrors the Telegram alert gate). */
function isAlertable(v: LivenessVerdict): boolean {
  return (v.state === "down" || v.state === "stale") && (v.catalogStatus === "live" || v.catalogStatus === "partial");
}

/** Filesystem/DB-safe proposal id, stable per (agent, state) so it upserts idempotently. */
function livenessProposalId(agentId: string, state: string): string {
  return `wolverine-liveness-${agentId}-${state}`.replace(/[^a-zA-Z0-9._-]/g, "-");
}

/**
 * Build advisory Wolverine FixProposals from a Sentinel fleet snapshot. One per down/stale
 * expected-live agent. PURE — never throws; `now` is injected.
 */
export function sentinelWolverineProposals(fleet: FleetLiveness, now: string): ProposalQueueItem[] {
  const out: ProposalQueueItem[] = [];
  const verdicts = Array.isArray(fleet?.verdicts) ? fleet.verdicts : [];
  for (const v of verdicts) {
    if (!isAlertable(v)) continue;
    const id = livenessProposalId(v.agentId, v.state);
    out.push({
      id,
      domain: "system",
      actionType: "sync_repair_plan",
      title: `Wolverine: ${v.displayName} is ${v.state} — investigate`,
      description:
        `Sentinel detected ${v.displayName} (${v.agentId}) is ${v.state} ` +
        `(${v.ageHours ?? "?"}h since last evidence). ${v.reason}`,
      sourceIntent: `sentinel:liveness:${v.agentId}`,
      proposedPayload: {
        agentId: v.agentId,
        state: v.state,
        lastEvidenceAt: v.lastEvidenceAt,
        ageHours: v.ageHours,
        evidenceSource: v.evidenceSource,
      },
      expectedEffect:
        `Hart (or Wolverine's gated repair path) investigates why ${v.displayName} is ${v.state} ` +
        `and restores it. Advisory — no automatic repair occurs.`,
      riskLevel: v.state === "down" ? "high" : "medium",
      requiredApproval: "Hart",
      status: "pending_approval",
      executable: false,
      blockedReason:
        "Advisory liveness finding — Wolverine detects + proposes; restoring an agent is gated and never automatic.",
      expiresAt: null,
      safetyNotes: [
        "Auto-raised by the Sentinel→Wolverine bridge when an expected-live agent went down/stale.",
        "Advisory: approval does not execute anything; Wolverine detects + proposes, it never repairs.",
      ],
      dryRunResult: null,
      createdAt: now,
      updatedAt: now,
      auditEvents: [{ at: now, event: "created", detail: `Sentinel→Wolverine: ${v.agentId} ${v.state}` }],
      tier: "T0",
      targetId: v.agentId,
      targetName: v.displayName,
      beforeState: { state: v.state, lastEvidenceAt: v.lastEvidenceAt },
      afterState: {},
      rollbackOrCorrectionNote:
        "Advisory only; nothing to roll back. Resolves when the agent recovers or Hart dismisses it.",
    });
  }
  return out;
}
