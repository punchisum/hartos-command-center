/**
 * src/hartos/council-factory-bridge.ts
 *
 * P7 Council->Factory bridge (PURE CORE, injectable deps).
 *
 * When a council proposal is APPROVED (status `simulated_approved`), this module
 * turns its recommendation into a Factory build-plan proposal: domain="factory",
 * actionType="build_agent_plan", status="pending_approval", executable=false.
 *
 * PROPOSE-ONLY / DISARMED: it produces a proposal awaiting Hart's SECOND GO.
 * It NEVER scaffolds, provisions, or auto-executes anything. All of that remains
 * behind the normal factory gate + Hart's approval of the factory proposal.
 *
 * === P7 CONCRETIZE PASS ===
 * `bridgeCouncilToFactory` is now async. Before driving the Factory it runs
 * `concretizeCouncilToSpec` (a focused Claude-on-Max LLM call) to turn the council's
 * strategic prose into a concrete, Factory-buildable agent spec.  If concretize returns
 * null (any failure, thin result), the bridge returns {ok:false} immediately -- no
 * proposal, no throw.
 *
 * With a concrete spec in hand the bridge bypasses the inbox/interrogation path
 * (which rightly refuses vague prose) and drives the Factory via the DIRECT-SPEC
 * path: compileSpecToManifest + planFromManifest.  This avoids fighting the
 * interrogator with strategic answers and produces a non-refused plan.
 *
 * Pure + deterministic (when given the same infer output): factory compiler/planner
 * are injected via deps for unit-testability (no DB, no network, no ambient clock
 * reads in this module).
 */

import type { CouncilProposalPayload } from "../council/council-types.js";
import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
import type { InterrogationAnswer } from "../research/agent-job-types.js";
import type { Infer } from "../council/specialist.js";
import type { AgentSpec, AgentManifest, ManifestViolation } from "./manifest-types.js";
import type { ImplementationPlan } from "./manifest-build-planner.js";
import type { ReadModelType } from "../read-models/read-model-types.js";
import {
  compileSpecToManifest,
  validateManifest,
} from "./manifest-compiler.js";
import { planFromManifest } from "./manifest-build-planner.js";
import {
  startFactoryJob,
  advanceFactoryJob,
  type FactoryJobState,
  type StartFactoryJobOptions,
  type FactoryJobAdvanceInput,
  type AdvanceFactoryJobOptions,
} from "./factory-coordinator.js";
import {
  concretizeCouncilToSpec,
  type ConcreteAgentSpec,
} from "./council-spec-concretizer.js";

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
  /** Injectable compileSpecToManifest (for tests). */
  compileSpecToManifest?: (spec: AgentSpec) => AgentManifest;
  /** Injectable validateManifest (for tests). */
  validateManifest?: (manifest: AgentManifest) => ManifestViolation[];
  /** Injectable planFromManifest (for tests). */
  planFromManifest?: (
    manifest: AgentManifest,
    opts?: { now?: string },
  ) => ImplementationPlan;
  /** Injectable concretizeCouncilToSpec (for tests -- avoids real LLM calls). */
  concretizeCouncilToSpec?: (
    payload: CouncilProposalPayload,
    infer: Infer,
  ) => Promise<ConcreteAgentSpec | null>;
}

// ─── Build InterrogationAnswer[] from a CouncilProposalPayload ─────────────────

/**
 * Map the council's rich payload onto the 5 spec-lock dimensions + measurable criteria.
 * Kept for backward-compatibility with existing tests and as a fallback reference.
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

// ─── ConcreteAgentSpec -> AgentSpec projection ──────────────────────────────────

/**
 * Project a `ConcreteAgentSpec` (LLM output) onto an `AgentSpec` (Factory compiler input).
 *
 * Maps the concrete fields to the spec shape required by `compileSpecToManifest`.
 * Uses sensible HartOS defaults where the concrete spec doesn't carry an exact
 * value (jobType=monitoring, targetReadModelType=other, etc.).  Never invents
 * capabilities or criteria beyond what the concretize pass provided.
 */
function concreteSpecToAgentSpec(
  concreteSpec: ConcreteAgentSpec,
  councilProposalId: string,
): AgentSpec {
  const slug = concreteSpec.agentName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  const specId = `spec-council-${slug}-${councilProposalId.slice(-12).replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;

  // Map to a known ReadModelType -- "other" is the safe fallback for novel domains.
  const targetReadModelType: ReadModelType = "other";

  return {
    specId,
    agentName: concreteSpec.agentName,
    domain: "personal_os",
    targetReadModelType,
    purpose: concreteSpec.capability,
    dataSources: concreteSpec.readSources,
    capabilities: concreteSpec.commands,
    label: concreteSpec.agentName,
    icon: "agent",
    proposalTypes: ["propose_" + slug.replace(/-/g, "_")],
    outputs: [],
    jobType: "monitoring",
    boundary: {
      // Non-empty stop condition satisfies the BoundaryDefinition requirement.
      stopConditions: ["Hart rejects or approves the build-plan proposal"],
      // HartOS doctrine: read-only agents never write files.
      maxFilesWritten: 0,
      externalNetworkAllowed: false,
      llmAllowed: false,
    },
    acceptanceCriteria: [concreteSpec.measurableAcceptance],
    riskLevel: "medium",
    prereqs: [],
    cockpitDone: true,
    approvalRequired: true,
    failureMode: concreteSpec.failureMode,
  };
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
 * === P7 concretize pass (new) ===
 * Before driving the Factory this function first calls `concretizeCouncilToSpec`
 * (injected via deps or the real implementation) to turn strategic prose into a concrete
 * agent spec.  If concretize returns null (any failure), returns {ok:false} -- no proposal,
 * no throw.
 *
 * With a concrete spec in hand the bridge uses the DIRECT-SPEC path:
 *   compileSpecToManifest(agentSpec)   -> AgentManifest
 *   validateManifest(manifest)         -> violations[]
 *   planFromManifest(manifest, {now})  -> ImplementationPlan
 * This bypasses the inbox/interrogation path that rightly refuses vague prose.
 * If any Factory step fails or produces violations, the bridge returns {ok:false,reason}.
 *
 * The resulting plan is packaged as a ProposalQueueItem with:
 *   domain="factory", actionType="build_agent_plan",
 *   status="pending_approval", executable=false, tier="T3".
 *
 * Never throws. All errors are caught and returned as {ok:false,reason}.
 *
 * @param councilPayload      The CouncilProposalPayload from the approved council proposal.
 * @param councilProposalId   The stable id of the council proposal (used for idempotency).
 * @param now                 Injected ISO timestamp string (never reads the ambient clock).
 * @param infer               The Claude-on-Max Infer seam (injected; required for concretize).
 * @param deps                Optional injectable factory functions (for tests).
 */
export async function bridgeCouncilToFactory(
  councilPayload: CouncilProposalPayload,
  councilProposalId: string,
  now: string,
  infer: Infer,
  deps: CouncilFactoryBridgeDeps = {},
): Promise<BridgeResult> {
  try {
    const { rootGoal, recommendation, confidence } = councilPayload;

    // ── 1. Concretize pass: strategic prose → concrete Factory-buildable spec ────
    const doConcretize = deps.concretizeCouncilToSpec ?? concretizeCouncilToSpec;
    const concreteSpec = await doConcretize(councilPayload, infer);
    if (!concreteSpec) {
      return {
        ok: false,
        reason:
          "Concretize pass failed or returned too-thin result: the council payload did not yield a concrete, Factory-buildable agent spec. No proposal created.",
      };
    }

    // ── 2. Project onto AgentSpec ────────────────────────────────────────────────
    const agentSpec = concreteSpecToAgentSpec(concreteSpec, councilProposalId);

    // ── 3. Compile the spec to a manifest (direct-spec path, bypasses interrogation) ──
    const doCompile = deps.compileSpecToManifest ?? compileSpecToManifest;
    let manifest: AgentManifest;
    try {
      manifest = doCompile(agentSpec);
    } catch (e) {
      return {
        ok: false,
        reason: `compileSpecToManifest threw: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    // ── 4. Validate manifest ─────────────────────────────────────────────────────
    const doValidate = deps.validateManifest ?? validateManifest;
    let violations: ManifestViolation[];
    try {
      violations = doValidate(manifest);
    } catch (e) {
      return {
        ok: false,
        reason: `validateManifest threw: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    if (violations.length > 0) {
      const details = violations.map((v) => `${v.facet}: ${v.detail}`).join("; ");
      return {
        ok: false,
        reason: `Manifest has ${violations.length} violation(s) — refusing to propose: ${details}`,
      };
    }

    // ── 5. Plan the manifest → ImplementationPlan ────────────────────────────────
    const doPlan = deps.planFromManifest ?? planFromManifest;
    let plan: ImplementationPlan;
    try {
      plan = doPlan(manifest, { now });
    } catch (e) {
      return {
        ok: false,
        reason: `planFromManifest threw: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    // ── 6. Build the ProposalQueueItem ───────────────────────────────────────────
    const hasViolations = (plan.violations?.length ?? 0) > 0;
    const riskLevel = hasViolations
      ? "high"
      : confidence === "high"
      ? "low"
      : confidence === "medium"
      ? "medium"
      : "high";

    const proposalId = makeFactoryProposalId(councilProposalId);
    const specId = agentSpec.specId;
    const agentName = agentSpec.agentName;

    const title = `Factory Build Plan: ${rootGoal.slice(0, 100)} [council-${confidence}]`;
    const description =
      `Council-approved goal: "${rootGoal}". ` +
      `Council recommendation: "${recommendation.slice(0, 200)}". ` +
      `Confidence: ${confidence}. ` +
      `Concrete agent: ${agentName} (${concreteSpec.capability}). ` +
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
        manifestRef: { specId: manifest.spec.specId, agentName: manifest.spec.agentName },
        councilGoal: rootGoal,
        councilConfidence: confidence,
        councilRecommendation: recommendation,
        councilProposalId,
        concreteSpec: {
          agentName: concreteSpec.agentName,
          capability: concreteSpec.capability,
          readSources: concreteSpec.readSources,
          output: concreteSpec.output,
          commands: concreteSpec.commands,
          interfaces: concreteSpec.interfaces,
          measurableAcceptance: concreteSpec.measurableAcceptance,
          failureMode: concreteSpec.failureMode,
        },
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
        "This proposal was generated by the council->factory bridge -- no code was scaffolded.",
        "Approve the factory proposal to proceed to Hart's final build authorization.",
        `Council confidence: ${confidence}. Plan violations: ${plan.violations?.length ?? 0}.`,
        "executable=false; no provisioning path is active in this proposal.",
        `Concretize pass used: concrete agent spec derived from council specialist findings.`,
      ],
      dryRunResult: null,
      createdAt: now,
      updatedAt: now,
      auditEvents: [
        {
          at: now,
          event: "created",
          detail: `Factory build-plan proposal created by council-bridge (concretize path) for councilProposalId=${councilProposalId} (confidence=${confidence}, agent=${agentName}, plan.violations=${plan.violations?.length ?? 0})`,
        },
      ],
      tier: "T3",
      targetId: proposalId,
      targetName: `factory:${rootGoal.slice(0, 60)}`,
      beforeState: {},
      afterState: {
        specId,
        agentName,
        planConfidence: plan.confidence ?? null,
        planViolations: plan.violations?.length ?? 0,
        councilConfidence: confidence,
        concreteAgentName: concreteSpec.agentName,
      },
      rollbackOrCorrectionNote:
        "Reject the factory proposal; nothing is built or provisioned. No rollback needed -- no scaffolding occurred.",
    };

    return { ok: true, proposal, reason: `Factory build-plan proposal created: ${proposalId}` };
  } catch (e) {
    // Outermost never-throw guard.
    return {
      ok: false,
      reason: `council-factory-bridge: unexpected error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
