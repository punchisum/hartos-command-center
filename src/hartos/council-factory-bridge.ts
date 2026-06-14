/**
 * src/hartos/council-factory-bridge.ts
 *
 * P7 Council→Factory bridge (PURE CORE, injectable deps).
 *
 * When a council proposal is APPROVED (status `simulated_approved`), this module
 * turns its recommendation into a Factory build-plan proposal: domain="factory",
 * actionType="build_agent_plan", status="pending_approval", executable=false.
 *
 * PROPOSE-ONLY / DISARMED: it produces a proposal awaiting Hart's SECOND GO.
 * It NEVER scaffolds, provisions, or auto-executes anything. All of that remains
 * behind the normal factory gate + Hart's approval of the factory proposal.
 *
 * Pure + deterministic: factory functions are injected via deps for unit-testability
 * (no DB, no network, no ambient clock reads in this module).
 */

import type { CouncilProposalPayload } from "../council/council-types.js";
import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
import type { InterrogationAnswer } from "../research/agent-job-types.js";
import {
  startFactoryJob,
  advanceFactoryJob,
  type FactoryJobState,
  type StartFactoryJobOptions,
  type FactoryJobAdvanceInput,
  type AdvanceFactoryJobOptions,
} from "./factory-coordinator.js";

// ─── Injectable deps (for unit testing without real Factory I/O) ───────────────

export interface CouncilFactoryBridgeDeps {
  startFactoryJob?: (
    requestText: string,
    opts?: StartFactoryJobOptions,
  ) => FactoryJobState;
  advanceFactoryJob?: (
    state: FactoryJobState,
    input: FactoryJobAdvanceInput,
    opts?: AdvanceFactoryJobOptions,
  ) => FactoryJobState;
}

// ─── Build InterrogationAnswer[] from a CouncilProposalPayload ─────────────────

/**
 * Map the council's rich payload onto the 5 spec-lock dimensions + measurable criteria.
 * The council already answered these questions implicitly; we surface honest, direct
 * answers derived from the recommendation, confidence, and tree findings.
 *
 * `answeredBy: "council-bridge"` marks these as machine-derived (not Hart-direct).
 * `answeredAt`: injected `now` string.
 */
export function buildInterrogationAnswers(
  payload: CouncilProposalPayload,
  now: string,
): InterrogationAnswer[] {
  const by = "council-bridge";
  const { rootGoal, recommendation, confidence, tree } = payload;

  // Collect specialist summaries for richer answers.
  const summaries = tree.findings.map((f) => f.summary).join("; ") || recommendation;
  const risks = tree.findings.flatMap((f) => f.risks);
  const riskText = risks.length > 0 ? risks.join("; ") : "none identified by council";

  return [
    {
      questionId: "read_source",
      answer: `Council synthesis for goal: "${rootGoal}". Data sources drawn from specialist findings: ${summaries.slice(0, 300)}.`,
      answeredBy: by,
      answeredAt: now,
    },
    {
      questionId: "output",
      answer: `Council recommendation: "${recommendation.slice(0, 300)}". Confidence: ${confidence}. Produces a factory build-plan proposal for Hart's review.`,
      answeredBy: by,
      answeredAt: now,
    },
    {
      questionId: "proposal_type",
      answer: `Propose-only build-plan proposal (domain=factory, actionType=build_agent_plan). No execution until Hart approves the factory proposal. Council itself is strictly proposal-only.`,
      answeredBy: by,
      answeredAt: now,
    },
    {
      questionId: "cockpit_done",
      answer: `Done when a pending_approval factory build-plan proposal appears in the cockpit carrying the council's recommendation and the full implementation plan. Hart sees it in the Factory domain panel.`,
      answeredBy: by,
      answeredAt: now,
    },
    {
      questionId: "failure_mode",
      answer: `Fails safe: if the council recommendation is refused by the Factory (vague/unsafe spec), the bridge returns ok:false and no proposal is upserted. Risks from council: ${riskText.slice(0, 200)}. Rollback: reject the factory proposal; nothing is built or provisioned.`,
      answeredBy: by,
      answeredAt: now,
    },
    {
      questionId: "measurable_acceptance_criteria",
      answer: `A factory proposal with status=pending_approval and executable=false appears in the cockpit spine within one bridge cycle. Council confidence=${confidence}. Zero scaffolding or provisioning until Hart approves.`,
      answeredBy: by,
      answeredAt: now,
    },
  ];
}

// ─── Stable proposal id (idempotency key) ─────────────────────────────────────

/**
 * Produce a stable, DB-safe proposal id from a council proposal id.
 * Mirrors the council proposal id pattern: `prop-factory-<suffix>`.
 *
 * Uses the last 32 chars of the council id (or the whole thing if shorter),
 * sanitised to alphanumerics and hyphens so it is safe in URLs, filenames, and DB cols.
 */
export function makeFactoryProposalId(councilProposalId: string): string {
  const suffix = councilProposalId
    .slice(-32)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
  return `prop-factory-${suffix}`;
}

// ─── Bridge result ──────────────────────────────────────────────────────────────

export interface BridgeResult {
  ok: boolean;
  proposal?: ProposalQueueItem;
  reason: string;
}

// ─── Core bridge function ──────────────────────────────────────────────────────

/**
 * Drive the Factory lifecycle from a council payload and produce a factory build-plan
 * proposal. PROPOSE-ONLY: the returned proposal is pending_approval + executable:false.
 *
 * Factory lifecycle driven (non-interactively, from pre-known council answers):
 *   startFactoryJob(rootGoal)
 *     → if refused: {ok:false, reason}
 *   advanceFactoryJob(state, {answers})          → spec_ready
 *     → if not spec_ready: {ok:false, reason}
 *   advanceFactoryJob(state, {approved:true})    → manifest_compiled
 *     → if not manifest_compiled: {ok:false, reason}
 *   advanceFactoryJob(state, {})                 → planned
 *     → if not planned: {ok:false, reason}
 *   advanceFactoryJob(state, {approved:true})    → awaiting_approval
 *     → if not awaiting_approval: {ok:false, reason}
 *
 * The resulting plan is packaged as a ProposalQueueItem with:
 *   domain="factory", actionType="build_agent_plan",
 *   status="pending_approval", executable=false, tier="T3".
 *
 * Pure (factory fns injectable via deps for tests). Never throws.
 *
 * @param councilPayload  The CouncilProposalPayload from the approved council proposal.
 * @param councilProposalId  The stable id of the council proposal (used for idempotency).
 * @param now  Injected ISO timestamp string (never reads the ambient clock).
 * @param deps  Optional injectable factory functions (for tests).
 */
export function bridgeCouncilToFactory(
  councilPayload: CouncilProposalPayload,
  councilProposalId: string,
  now: string,
  deps: CouncilFactoryBridgeDeps = {},
): BridgeResult {
  const doStart = deps.startFactoryJob ?? startFactoryJob;
  const doAdvance = deps.advanceFactoryJob ?? advanceFactoryJob;

  const { rootGoal, recommendation, confidence } = councilPayload;

  // 1. Start the Factory job.
  let state = doStart(rootGoal, { now });
  if (state.status === "refused") {
    return {
      ok: false,
      reason: `Factory refused the council goal: ${state.refusalReason ?? "unknown reason"}`,
    };
  }

  // 2. If interrogating (the normal buildable path), advance with answers.
  if (state.status === "interrogating") {
    const answers = buildInterrogationAnswers(councilPayload, now);
    state = doAdvance(state, { answers }, { now });
    if (state.status !== "spec_ready") {
      return {
        ok: false,
        reason: `Factory could not reach spec_ready after answers (status=${state.status}): ${
          state.refusalReason ?? state.interrogation?.reason ?? "interrogation incomplete"
        }`,
      };
    }
  }

  // 3. Approve the spec → manifest_compiled.
  if (state.status === "spec_ready") {
    state = doAdvance(state, { approved: true }, { now });
    if (state.status !== "manifest_compiled") {
      return {
        ok: false,
        reason: `Factory could not reach manifest_compiled after spec approval (status=${state.status}): ${state.refusalReason ?? "unknown"}`,
      };
    }
  }

  // 4. Plan the manifest → planned.
  if (state.status === "manifest_compiled") {
    state = doAdvance(state, {}, { now });
    if (state.status !== "planned") {
      return {
        ok: false,
        reason: `Factory could not reach planned from manifest_compiled (status=${state.status}): ${state.refusalReason ?? "unknown"}`,
      };
    }
  }

  // 5. Approve the plan → awaiting_approval (the Factory's own human gate, with the plan).
  if (state.status === "planned") {
    state = doAdvance(state, { approved: true }, { now });
    if (state.status !== "awaiting_approval") {
      return {
        ok: false,
        reason: `Factory could not reach awaiting_approval after plan approval (status=${state.status}): ${state.refusalReason ?? "unknown"}`,
      };
    }
  }

  if (state.status !== "awaiting_approval") {
    return {
      ok: false,
      reason: `Unexpected Factory status after lifecycle: ${state.status}`,
    };
  }

  // 6. Build the ProposalQueueItem.
  const plan = state.plan;
  const spec = state.spec;
  const manifest = state.manifest;

  // Risk: any violations → "high"; otherwise derive from council confidence.
  const hasViolations = (plan?.violations?.length ?? 0) > 0;
  const riskLevel = hasViolations
    ? "high"
    : confidence === "high"
    ? "low"
    : confidence === "medium"
    ? "medium"
    : "high";

  const proposalId = makeFactoryProposalId(councilProposalId);
  const specId = spec?.specId ?? state.jobId;
  const agentName = spec?.agentName ?? "council-derived-agent";

  const title = `Factory Build Plan: ${rootGoal.slice(0, 100)} [council-${confidence}]`;
  const description =
    `Council-approved goal: "${rootGoal}". ` +
    `Council recommendation: "${recommendation.slice(0, 200)}". ` +
    `Confidence: ${confidence}. ` +
    `This is a propose-only factory build-plan. Hart must approve before any scaffolding or provisioning.`;

  const proposal: ProposalQueueItem = {
    id: proposalId,
    domain: "factory",
    actionType: "build_agent_plan",
    title,
    description,
    sourceIntent: `council-bridge:${councilProposalId}`,
    proposedPayload: {
      specId,
      agentName,
      plan: plan ?? null,
      manifestRef: manifest
        ? { specId: manifest.spec.specId, agentName: manifest.spec.agentName }
        : null,
      councilGoal: rootGoal,
      councilConfidence: confidence,
      councilRecommendation: recommendation,
      councilProposalId,
    },
    expectedEffect:
      `If Hart approves this factory proposal, HartOS will scaffold the "${agentName}" agent ` +
      `per the implementation plan. No scaffolding or provisioning occurs until that second approval.`,
    riskLevel,
    requiredApproval: "Hart",
    status: "pending_approval",
    executable: false,
    blockedReason:
      "Council-factory bridge: propose-only. Hart must approve this factory build-plan before any scaffolding or provisioning begins. This is the second gate (first was the council proposal).",
    expiresAt: null,
    safetyNotes: [
      "This proposal was generated by the council→factory bridge — no code was scaffolded.",
      "Approve the factory proposal to proceed to Hart's final build authorization.",
      `Council confidence: ${confidence}. Violations: ${plan?.violations?.length ?? 0}.`,
      "executable=false; no provisioning path is active in this proposal.",
    ],
    dryRunResult: null,
    createdAt: now,
    updatedAt: now,
    auditEvents: [
      {
        at: now,
        event: "created",
        detail: `Factory build-plan proposal created by council-bridge for councilProposalId=${councilProposalId} (confidence=${confidence}, violations=${plan?.violations?.length ?? 0})`,
      },
    ],
    tier: "T3",
    targetId: proposalId,
    targetName: `factory:${rootGoal.slice(0, 60)}`,
    beforeState: {},
    afterState: {
      specId,
      agentName,
      planConfidence: plan?.confidence ?? null,
      planViolations: plan?.violations?.length ?? 0,
      councilConfidence: confidence,
    },
    rollbackOrCorrectionNote:
      "Reject the factory proposal; nothing is built or provisioned. No rollback needed — no scaffolding occurred.",
  };

  return { ok: true, proposal, reason: `Factory build-plan proposal created: ${proposalId}` };
}
