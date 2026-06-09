/**
 * src/research/research-job.ts
 *
 * Slice G (3-levels-up master plan §7/§8) — the PURE Research Job lifecycle planner.
 *
 * It turns a research REQUEST into the universal `AgentJob` contract + a non-executable
 * Research Job Proposal (`ActionProposal`), composing the existing deterministic
 * `planResearch` (the F1 intelligence supply line) with the wave-1 AgentJob /
 * BoundaryDefinition canon. It NEVER executes, writes, fetches, or persists: it plans
 * the job and names what must be gathered — findings are never fabricated (they live in
 * `unknowns`).
 *
 * Doctrine baked into the shape (plan §7):
 *   - no interrogation = no job → §8 interrogation questions are always emitted;
 *   - no scope = no job → a locked `JobScope`;
 *   - no boundaries = no job → a FAIL-CLOSED `BoundaryDefinition` (network + LLM are left
 *     UNDEFINED so the boundary gate denies them by default — see ./boundary-gate.ts);
 *   - no artifact contract = no job → declared `outputArtifacts`;
 *   - no audit = no job completion → a seed `auditTrail` entry.
 *
 * §7 GATE: a request that is too broad / needs scoping / still has unanswered
 * interrogation does NOT reach `proposed`; it stays `requested` / `interrogating`.
 *
 * PURE: no I/O, no clock read. Time is INJECTED via `opts.now`; the planner must never
 * read the ambient system clock. Same request + same `now` ⇒ deep-equal output.
 *
 * Canonical types are IMPORTED, never redeclared.
 */

import {
  planResearch,
  type ResearchPlan,
  type ResearchRisk,
} from "./research-planner.js";
import type {
  AgentJob,
  AgentJobStatus,
  BoundaryDefinition,
  InterrogationAnswer,
  InterrogationItem,
  JobScope,
  OutputArtifact,
} from "./agent-job-types.js";
import type {
  ActionProposal,
  ProposalRisk,
  ProposalStatus,
} from "../cockpit/proposals/proposal-types.js";

/** A fixed epoch so a missing `opts.now` is still deterministic (never an ambient clock read). */
const DEFAULT_NOW = "1970-01-01T00:00:00.000Z";

/** The single approved write target for a planned research job (plan §8/§9). */
const RESEARCH_TARGET_FOLDER = "research/approved";

/** Max artifact files a research job may write — fail-closed numeric ceiling. */
const MAX_FILES_WRITTEN = 3;

/** Plan risk (low/medium/high) maps 1:1 onto the proposal risk word-set. */
function toProposalRisk(risk: ResearchRisk): ProposalRisk {
  return risk;
}

/** A short, deterministic slug for stable ids (no clock, no randomness). */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "research";
}

/**
 * §8 interrogation — the questions the Research Agent must answer BEFORE the job is
 * scoped/proposed (the worked virtual-card example). Deterministic ids (never LLM free
 * text used as a key). Each `required` question is a §7 gate: while any required answer
 * is missing the job may NOT advance to `proposed`.
 */
function interrogationFor(plan: ResearchPlan): InterrogationItem[] {
  return [
    {
      id: "decision",
      question: `What decision does researching "${plan.question}" need to support?`,
      rationale: "No decision = no scope; the output must serve a concrete decision (§7).",
      required: true,
    },
    {
      id: "geography",
      question: "Which geography / user group, and does it need localizing (e.g. SG/HK/EU)?",
      rationale: "Localization changes which sources are trustworthy and whether findings transfer.",
      required: true,
    },
    {
      id: "depth",
      question: "What depth: brief, comparison matrix, or full report?",
      rationale: "Depth bounds effort and the output artifact contract.",
      required: true,
    },
    {
      id: "sources",
      question: "Which sources are allowed (web? internal docs?) and any disallowed?",
      rationale: "Sources are a boundary; the gate refuses anything off the declared lists.",
      required: true,
    },
    {
      id: "dimensions",
      question: "Which dimensions matter (legal, integration, cost, approval-rate, API, optics)?",
      rationale: "Pins the sub-questions to the dimensions that actually drive the decision.",
      required: false,
    },
    {
      id: "target_folder",
      question: `Where should the report be saved (default: ${RESEARCH_TARGET_FOLDER})?`,
      rationale: "Writing a report is a mutation; the target must be an approved folder (§9).",
      required: false,
    },
    {
      id: "follow_ups",
      question: "What follow-up actions, if any, may the job propose?",
      rationale: "Follow-ups are proposed, never executed; this bounds them up front.",
      required: false,
    },
  ];
}

/** A locked scope (no scope = no job), derived from the plan — descriptive only. */
function scopeFor(plan: ResearchPlan): JobScope {
  return {
    statement: `Research "${plan.question}" to the depth needed to support a decision (${plan.shape}-shaped).`,
    inScope: plan.subQuestions,
    outOfScope: [
      "Fabricating findings (answers are gathered, never invented).",
      "Acting on the findings (the job proposes follow-ups; it never executes them).",
      "Writing outside the approved target folder.",
    ],
    decisionSupported: `Inform a ${plan.shape}-shaped decision about ${plan.question}.`,
    localization: [],
  };
}

/**
 * The FAIL-CLOSED BoundaryDefinition (plan §7). `externalNetworkAllowed` and `llmAllowed`
 * are deliberately LEFT UNDEFINED so `checkBoundary` denies network + LLM by default — a
 * job must explicitly declare those capabilities later (a gated, human-approved step). We
 * DO declare the safe constraints: stop conditions, a file ceiling, and the single
 * approved target folder.
 */
function boundaryFor(plan: ResearchPlan): BoundaryDefinition {
  return {
    maxFilesWritten: MAX_FILES_WRITTEN,
    targetFolder: RESEARCH_TARGET_FOLDER,
    // externalNetworkAllowed / llmAllowed intentionally undefined ⇒ DENIED by the gate.
    humanLocalizationNeeded: true,
    stopConditions: [
      "Stop when every sub-question is answered from gathered sources.",
      `Stop if the boundary gate refuses (e.g. an undeclared capability, > ${MAX_FILES_WRITTEN} files, a disallowed source).`,
      `Stop and re-interrogate if the request is ${plan.verdict === "TOO_BROAD" ? "too broad" : "still under-scoped"}.`,
    ],
  };
}

/** The declared output contract (no artifact contract = no job) — all write to the approved folder. */
function artifactsFor(plan: ResearchPlan): OutputArtifact[] {
  const id = slug(plan.question);
  return [
    {
      id: `${id}-summary`,
      kind: "cockpit exec summary",
      targetFolder: RESEARCH_TARGET_FOLDER,
      description: "One-screen summary for the cockpit (verdict + main findings).",
    },
    {
      id: `${id}-report`,
      kind: "full report",
      targetFolder: RESEARCH_TARGET_FOLDER,
      description: "Full report: findings, localized implications, source pack, risk table, unknowns.",
    },
  ];
}

/**
 * §7 GATE — the status a planned research job may hold before Hart's approval.
 *
 * A READY_TO_RESEARCH plan that the planner judged researchable reaches `proposed`
 * (its interrogation questions are surfaced for Hart, but the request is well-formed).
 * A request the planner judged TOO_BROAD stays `requested`; one that NEEDS_SCOPING — or
 * one where answers were supplied yet a REQUIRED interrogation item is still outstanding —
 * stays `interrogating`. The job NEVER skips to an approved / executor-only state; that is
 * Hart's call later. The broadness/scoping gate wins first, regardless of answers.
 */
function gateStatus(plan: ResearchPlan, hasUnansweredRequired: boolean): AgentJobStatus {
  if (plan.verdict === "TOO_BROAD") return "requested";
  if (plan.verdict === "NEEDS_SCOPING") return "interrogating";
  if (hasUnansweredRequired) return "interrogating";
  return "proposed";
}

/**
 * Whether a REQUIRED interrogation item is still unanswered.
 *
 * This gate only bites once answers are being CAPTURED: with no answers supplied (the
 * common freshly-planned case) it returns false, so a READY request proposes and its
 * questions ride along for Hart. Once any answer is supplied, every required question
 * must be answered before the job may reach `proposed`.
 */
function hasUnansweredRequired(
  questions: InterrogationItem[],
  answers: InterrogationAnswer[],
): boolean {
  if (answers.length === 0) return false;
  const answered = new Set(answers.map((a) => a.questionId));
  return questions.some((q) => q.required && !answered.has(q.id));
}

export interface BuildResearchJobOpts {
  /** Injected wall-clock ISO string. The planner NEVER reads the ambient clock. */
  now?: string;
  /** Who asked — defaults to "Hart". */
  requester?: string;
  /** Captured interrogation answers, if any (the §7 interrogation gate keys off these). */
  answers?: InterrogationAnswer[];
}

/**
 * Build the universal `AgentJob` for a research request (status reflects the §7 gate).
 *
 * PURE + deterministic: same `request` + same `opts.now` ⇒ deep-equal job. The job is a
 * DATA contract only — nothing here executes, writes, fetches, or persists. A
 * READY_TO_RESEARCH request lands in `proposed` (interrogation questions surface for
 * Hart); a TOO_BROAD request stays `requested` and a NEEDS_SCOPING one stays
 * `interrogating`. If answers are supplied but a required one is missing, the job stays
 * `interrogating`. Findings are never fabricated — they live in `unknowns`.
 */
export function buildResearchJob(request: string, opts: BuildResearchJobOpts = {}): AgentJob {
  const now = opts.now ?? DEFAULT_NOW;
  const requester = opts.requester ?? "Hart";
  const answers = opts.answers ?? [];
  const plan = planResearch(request);

  const interrogationQuestions = interrogationFor(plan);
  const scope = scopeFor(plan);
  const boundaryDefinition = boundaryFor(plan);
  const outputArtifacts = artifactsFor(plan);

  const status = gateStatus(plan, hasUnansweredRequired(interrogationQuestions, answers));

  return {
    jobId: `job-${slug(plan.question)}-${now}`,
    agentType: "research",
    jobType: "research",
    requestText: request,
    requester,
    status,

    interrogationQuestions,
    answers,

    scope,
    boundaryDefinition,
    decisionSupported: scope.decisionSupported,

    dataSources: [],
    allowedSources: [],
    disallowedSources: [],

    outputArtifacts,
    targetFolder: RESEARCH_TARGET_FOLDER,

    cockpitSummary: `${plan.verdict} — ${plan.reason}`,
    mainFindings: [],
    localizedImplications: [],
    proposedActions: [],

    // Confidence is honest "unknown": nothing has been gathered, so no findings exist.
    confidence: "unknown",
    unknowns: plan.unknowns,

    auditTrail: [
      {
        at: now,
        event: "job_planned",
        detail: `Planned from request (${plan.shape}/${plan.verdict}); status=${status}. No findings gathered.`,
      },
    ],

    createdAt: now,
    completedAt: null,
    freshness: "unknown",

    failureMode: null,
    rollbackOrCorrectionNote:
      "If a finding is wrong, discard it and re-gather from sources — no output is acted on without Hart's approval.",
  };
}

export interface ProposeResearchJobResult {
  job: AgentJob;
  proposal: ActionProposal;
}

export interface ProposeResearchJobOpts extends BuildResearchJobOpts {
  /** Proposal lifecycle status — defaults to "draft". Never an executor-only state. */
  proposalStatus?: ProposalStatus;
}

/**
 * Build the `AgentJob` PLUS its Research Job Proposal (a canonical `ActionProposal`).
 *
 * The proposal is domain "research", actionType "research_plan", `executable: false`,
 * `requiredApproval: "Hart"`, status from `opts.proposalStatus` (default "draft"). It is
 * a non-executable DRAFT describing what the job WOULD do — it carries NO dry-run and
 * NEVER triggers execution. PURE + deterministic.
 */
export function proposeResearchJob(
  request: string,
  opts: ProposeResearchJobOpts = {},
): ProposeResearchJobResult {
  const now = opts.now ?? DEFAULT_NOW;
  const job = buildResearchJob(request, opts);
  const plan = planResearch(request);

  const proposal: ActionProposal = {
    id: `prop-research-${slug(plan.question)}-${now}`,
    domain: "research",
    actionType: "research_plan",
    title: `Research Job: ${plan.question}`,
    description:
      `Non-executable Research Job Proposal (${plan.shape}, ${plan.verdict}). Job status: ${job.status}. ` +
      `${job.interrogationQuestions.length} interrogation question(s); ${plan.subQuestions.length} sub-question(s); ` +
      `needs to gather: ${plan.requiredInputs.join("; ")}. No findings are fabricated.`,
    sourceIntent: `research: ${request}`,
    proposedPayload: {
      jobId: job.jobId,
      jobStatus: job.status,
      shape: plan.shape,
      verdict: plan.verdict,
      decisionSupported: job.decisionSupported,
      interrogationQuestions: job.interrogationQuestions.map((q) => q.question),
      subQuestions: plan.subQuestions,
      requiredInputs: plan.requiredInputs,
      boundaryStopConditions: job.boundaryDefinition.stopConditions,
      outputArtifacts: job.outputArtifacts.map((a) => a.kind),
      targetFolder: job.targetFolder,
      unknowns: plan.unknowns,
      recommendedNextAction: plan.recommendedNextAction,
    },
    expectedEffect:
      "A scoped, boundaried research job (interrogation + sub-questions + the inputs to gather). " +
      "Nothing runs, writes, or fetches until Hart approves.",
    riskLevel: toProposalRisk(plan.risk),
    requiredApproval: "Hart",
    status: opts.proposalStatus ?? "draft",
    createdAt: now,
    expiresAt: null,
    safetyNotes: [
      "Non-executable draft — PLAN ONLY.",
      "No network / LLM / Supabase / file writes — boundaries are fail-closed by default.",
      "Requires Hart approval before the job runs, and again before writing to a new folder.",
    ],
    blockedReason: "Research jobs are plan-only here; execution is gated and requires Hart's approval.",
    dryRunResult: null,
    executable: false,
  };

  return { job, proposal };
}
