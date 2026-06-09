/**
 * src/hartos/spec-interrogator.ts
 *
 * LEVEL 1 — Factory Agent v1, capability 2: the SPEC INTERROGATOR (plan §1 cap 2, §8).
 *
 * The Factory Agent is a MANIFEST COMPILER, not a raw autonomous coder. Before any spec
 * is LOCKED (and long before any build), it GRILLS the build request: it refuses vague /
 * generic intent, asks domain-specific required questions, detects contradictions, forces
 * MEASURABLE acceptance criteria, and pins the FIVE spec-lock dimensions every born agent
 * must declare (read source · output · proposal type · cockpit-UI "done" · failure mode).
 * It then emits a spec-readiness VERDICT — and it NEVER self-approves: SPEC_READY means
 * "ready for Hart to approve the spec", not "approved".
 *
 * Doctrine baked into the shape (plan §1 Factory doctrine + §7/§8):
 *   - cannot build from vague intent → REFUSE_VAGUE / REFUSE_GENERIC gate the request out
 *     before interrogation is even worth asking;
 *   - must interrogate before spec-lock → required questions are always emitted, and an
 *     outstanding required answer keeps the verdict at NEEDS_INTERROGATION;
 *   - must produce measurable acceptance criteria → a dedicated required question, and its
 *     absence blocks SPEC_READY;
 *   - must define read source / output / proposal-type / cockpit-UI / failure-mode → the
 *     FIVE spec-lock dimensions, each gated;
 *   - must detect contradictions → `detectContradictions` (e.g. read-only + execute);
 *   - must validate risk + strategy before lock → DO_NOT_BUILD or unacceptable risk can
 *     never reach SPEC_READY;
 *   - never self-approve → SPEC_READY is the ceiling; it is a recommendation to Hart.
 *
 * PURE + deterministic, like `src/cockpit/agent-planner/agent-planner.ts`: no node:fs, no
 * pg, no network, no Supabase, no LLM, no clock read. Time is INJECTED via `opts.now`; the
 * module must never read the ambient system clock. Same request + same answers + same
 * `now` ⇒ deep-equal output.
 *
 * Canonical types are IMPORTED, never redeclared:
 *   - InterrogationItem / InterrogationAnswer ← ../research/agent-job-types.js (WAVE-2 canon)
 *   - classifyRequest / ClassifiedRequest / Domain / RiskLevel / StrategyVerdict ←
 *     ./request-classifier.js + ./orchestrator-types.js
 *   - reviewStrategy / StrategyReviewResult ← ./strategy-review.js
 */

import { classifyRequest } from "./request-classifier.js";
import { reviewStrategy } from "./strategy-review.js";
import type { ClassifiedRequest, Domain, RiskLevel, StrategyReviewResult } from "./orchestrator-types.js";
import type { InterrogationItem, InterrogationAnswer } from "../research/agent-job-types.js";

/** A fixed epoch so a missing `opts.now` is still deterministic (never an ambient clock read). */
const DEFAULT_NOW = "1970-01-01T00:00:00.000Z";

/** The stable id of the always-required measurable-acceptance-criteria question. */
export const MEASURABLE_CRITERIA_QUESTION_ID = "measurable_acceptance_criteria";

/**
 * The FIVE spec-lock dimensions every born agent MUST declare before the Factory locks a
 * spec (plan §1 Factory doctrine: "define read source / output / proposal-type / cockpit-UI
 * / failure-mode"). Each is a required interrogation item; an unanswered one blocks lock.
 */
export type SpecLockDimension =
  | "read_source"
  | "output"
  | "proposal_type"
  | "cockpit_done"
  | "failure_mode";

/** Stable, ordered list of the five spec-lock dimension ids (deterministic). */
export const SPEC_LOCK_DIMENSIONS: readonly SpecLockDimension[] = [
  "read_source",
  "output",
  "proposal_type",
  "cockpit_done",
  "failure_mode",
] as const;

/**
 * The spec-readiness verdict (plan §1 cap 2). NEVER an "approved" state — SPEC_READY is the
 * ceiling and means "ready for Hart to approve the spec", not "approved".
 *   - REFUSE_VAGUE     — too thin/empty to interrogate (the Factory refuses vague intent).
 *   - REFUSE_GENERIC   — a generic/thin agent with no concrete value anchor (refused).
 *   - NEEDS_INTERROGATION — required questions (incl. the five dimensions + measurable
 *                           criteria) are still unanswered.
 *   - NEEDS_RISK_REVIEW   — fully interrogated, but strategy says DO_NOT_BUILD or risk is
 *                           unacceptable / a contradiction blocks the spec.
 *   - SPEC_READY          — everything satisfied; ready for HART to approve (not approved).
 */
export type SpecReadiness =
  | "REFUSE_VAGUE"
  | "REFUSE_GENERIC"
  | "NEEDS_INTERROGATION"
  | "NEEDS_RISK_REVIEW"
  | "SPEC_READY";

/** The interrogation a build request must pass before its spec can be locked. */
export interface SpecInterrogation {
  request: string;
  domain: Domain;
  /** All interrogation questions (domain-specific + measurable criteria + five dimensions). */
  questions: InterrogationItem[];
  /** The five spec-lock dimension ids, surfaced explicitly for the manifest compiler. */
  dimensionIds: readonly SpecLockDimension[];
  /** The stable id of the measurable-acceptance-criteria question. */
  measurableCriteriaQuestionId: string;
}

export interface InterrogateSpecOptions {
  /** Captured interrogation answers, if any (does not change which questions are asked). */
  answers?: InterrogationAnswer[];
}

export interface AssessSpecReadinessOptions {
  /** Injected wall-clock ISO string. The assessor NEVER reads the ambient clock. */
  now?: string;
  /** Captured interrogation answers (the interrogation gate keys off these). */
  answers?: InterrogationAnswer[];
}

/** The full spec-readiness assessment — a recommendation to Hart, never an approval. */
export interface SpecReadinessResult {
  request: string;
  readiness: SpecReadiness;
  /** Honest, human-readable reason for the verdict. */
  reason: string;
  classification: ClassifiedRequest;
  strategy: StrategyReviewResult;
  interrogation: SpecInterrogation;
  /** Ids of REQUIRED questions still unanswered (empty once fully interrogated). */
  unansweredRequiredIds: string[];
  /** True once every required interrogation item is answered. */
  allRequiredAnswered: boolean;
  /** True once a measurable-acceptance-criteria answer is present. */
  measurableCriteriaPresent: boolean;
  /** Spec-lock dimension ids still undefined (a subset of the five). */
  undefinedDimensionIds: SpecLockDimension[];
  /** Contradictions found across the request + answers (empty when none). */
  contradictions: string[];
  /** The injected timestamp this assessment was made at. */
  assessedAt: string;
  /**
   * ALWAYS false. The Factory never self-approves; SPEC_READY only signals readiness for
   * Hart to approve. Surfaced explicitly so callers can never mistake readiness for approval.
   */
  selfApproved: false;
}

// ─── Vague / generic gates ──────────────────────────────────────────────────────

/** A request with this few real words is too thin to interrogate — refuse as vague. */
const MIN_MEANINGFUL_WORDS = 3;

/** Stop-words stripped before measuring how much real signal a request carries. */
const STOP_WORDS = new Set<string>([
  "a", "an", "the", "to", "for", "of", "and", "or", "i", "want", "need", "please",
  "build", "create", "make", "new", "spin", "up", "me", "my", "some", "that", "this",
  "it", "agent", "an", "do", "can", "you", "we",
]);

function meaningfulWords(request: string): string[] {
  return request
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}

/** Phrases that signal a generic/thin "do everything" agent with no concrete value anchor. */
const GENERIC_MARKERS = [
  "general purpose",
  "general-purpose",
  "do everything",
  "does everything",
  "do anything",
  "all-in-one",
  "all in one",
  "everything agent",
  "swiss army",
  "handle anything",
  "any task",
  "whatever i need",
  "magic",
];

function isVague(request: string): boolean {
  const trimmed = request.trim();
  if (trimmed.length < 8) return true;
  return meaningfulWords(trimmed).length < MIN_MEANINGFUL_WORDS;
}

function isGeneric(request: string): boolean {
  const t = request.toLowerCase();
  return GENERIC_MARKERS.some((m) => t.includes(m));
}

// ─── Domain-specific required questions ─────────────────────────────────────────

function has(text: string, ...needles: string[]): boolean {
  return needles.some((n) => text.includes(n));
}

/**
 * Domain-specific REQUIRED questions — the Factory must "ask domain Qs" (plan §1 cap 2).
 * Deterministic ids (never LLM free text used as a key). The shared questions (measurable
 * criteria + the five spec-lock dimensions) are added separately in `interrogateSpec`.
 */
function domainQuestions(domain: Domain, t: string): InterrogationItem[] {
  const items: InterrogationItem[] = [];

  if (domain === "tax" || domain === "finance") {
    items.push({
      id: "finance_jurisdiction",
      question: "Which jurisdiction / tax authority and filing year does this cover (e.g. SG IRAS FY2025)?",
      rationale: "Tax/finance rules are jurisdiction- and year-specific; a wrong basis makes every output wrong.",
      required: true,
    });
    items.push({
      id: "finance_evidence_trail",
      question: "What evidence trail (receipts, statements, audit log) must back each figure, and to what confidence?",
      rationale: "Financial figures need an auditable evidence trail; human approval is mandatory before any action.",
      required: true,
    });
    items.push({
      id: "finance_human_approval",
      question: "Who approves before any number is filed/exported, and is the agent strictly propose-only?",
      rationale: "Finance/tax is high-risk — the agent must propose, never act; a human must sign off.",
      required: true,
    });
  } else if (domain === "fitness") {
    items.push({
      id: "fitness_metrics",
      question: "Which metrics (sessions, volume, adherence, PRs) and over what window define success?",
      rationale: "Fitness signals are only useful against a defined metric + window.",
      required: true,
    });
    items.push({
      id: "fitness_data_source",
      question: "Where does the training data come from (logged workouts, wearable export, manual entry)?",
      rationale: "The read source determines confidence and freshness of every fitness signal.",
      required: true,
    });
  } else if (domain === "ops") {
    items.push({
      id: "ops_targets",
      question: "Which systems/services does this monitor, and what is the alert/SLA threshold?",
      rationale: "Ops monitoring is meaningless without the watched targets and a concrete threshold.",
      required: true,
    });
    items.push({
      id: "ops_read_only",
      question: "Is this read-only monitoring, or would it ever need to change ops state (and how is that gated)?",
      rationale: "Mutation vs read-only changes the entire safety envelope and the required gates.",
      required: true,
    });
  } else if (domain === "research") {
    items.push({
      id: "research_decision",
      question: "What decision must the research support, and which geography/localization applies?",
      rationale: "Research with no decision + no localization over-runs forever or transfers badly (§8).",
      required: true,
    });
  } else if (domain === "engineering" || domain === "command_center") {
    items.push({
      id: "engineering_scope",
      question: "What exact surface does this touch (which repo/module), and what is explicitly out of scope?",
      rationale: "Engineering builds drift without a pinned surface and an out-of-scope boundary.",
      required: true,
    });
  } else {
    // Unknown / personal_os — still force a concrete, non-generic value anchor.
    items.push({
      id: "concrete_problem",
      question: "What specific, repeated problem does this solve, and how do you do it manually today?",
      rationale: "A born agent needs a concrete value anchor; without one it is a generic/thin build (refused).",
      required: true,
    });
  }

  // A scheduled/recurring cue adds a cadence question regardless of domain.
  if (has(t, "schedule", "cron", "daily", "nightly", "weekly", "recurring", "digest", "every day", "every week")) {
    items.push({
      id: "cadence",
      question: "What cadence should it run on, and what triggers a run (time, event, manual)?",
      rationale: "A recurring agent must declare its cadence + trigger before lock.",
      required: false,
    });
  }

  return items;
}

/** The shared measurable-acceptance-criteria question (always required). */
function measurableCriteriaQuestion(): InterrogationItem {
  return {
    id: MEASURABLE_CRITERIA_QUESTION_ID,
    question:
      "What MEASURABLE acceptance criteria define 'working' (a number/threshold a human can check, " +
      "e.g. 'flags >=95% of late invoices', not 'be helpful')?",
    rationale: "The Factory must force measurable outputs — vague success criteria block spec-lock (§1 cap 2).",
    required: true,
  };
}

/** The five spec-lock dimension questions (all required) — read source / output / proposal-type / cockpit-UI / failure-mode. */
function dimensionQuestions(): InterrogationItem[] {
  return [
    {
      id: "read_source",
      question: "READ SOURCE: exactly what does the agent read (which Supabase tables, ClickUp, files, RPCs)?",
      rationale: "Spec-lock dimension 1 — every born agent must declare its read source.",
      required: true,
    },
    {
      id: "output",
      question: "OUTPUT: what does it produce (signal, summary, report, proposal), and in what shape?",
      rationale: "Spec-lock dimension 2 — the output contract must be defined before lock.",
      required: true,
    },
    {
      id: "proposal_type",
      question: "PROPOSAL TYPE: what kind of proposal/action does it surface (and is it strictly propose-only)?",
      rationale: "Spec-lock dimension 3 — the proposal type pins what the agent may recommend.",
      required: true,
    },
    {
      id: "cockpit_done",
      question: "COCKPIT 'DONE': what does the cockpit show when it is working (card + detail + which live signal)?",
      rationale: "Spec-lock dimension 4 — 'done' means visibly reading data + emitting a real signal in the cockpit.",
      required: true,
    },
    {
      id: "failure_mode",
      question: "FAILURE MODE: how does it fail safely, and what is the rollback/correction note when it is wrong?",
      rationale: "Spec-lock dimension 5 — a born agent must declare how it fails and how to correct it.",
      required: true,
    },
  ];
}

/**
 * Build the spec interrogation for a build request (plan §1 cap 2, §8). Pure.
 *
 * Emits, in a stable order: domain-specific required questions, the measurable-criteria
 * question, then the five spec-lock dimension questions. `opts.answers` is accepted for
 * symmetry but does NOT change which questions are asked — interrogation is fixed for a
 * given request so the surface is deterministic.
 */
export function interrogateSpec(request: string, _opts: InterrogateSpecOptions = {}): SpecInterrogation {
  const c = classifyRequest(request);
  const t = request.toLowerCase().trim();

  const questions: InterrogationItem[] = [
    ...domainQuestions(c.domain, t),
    measurableCriteriaQuestion(),
    ...dimensionQuestions(),
  ];

  return {
    request,
    domain: c.domain,
    questions,
    dimensionIds: SPEC_LOCK_DIMENSIONS,
    measurableCriteriaQuestionId: MEASURABLE_CRITERIA_QUESTION_ID,
  };
}

// ─── Contradiction detection ────────────────────────────────────────────────────

/** Concatenate the request + every answer into one lowercased haystack for contradiction scans. */
function corpus(request: string, answers: InterrogationAnswer[]): string {
  return [request, ...answers.map((a) => a.answer)].join(" • ").toLowerCase();
}

/** Does any answer to a question whose id contains `idFragment` mention any needle? */
function answerFor(answers: InterrogationAnswer[], idFragment: string): string {
  return answers
    .filter((a) => a.questionId.includes(idFragment))
    .map((a) => a.answer.toLowerCase())
    .join(" ");
}

/**
 * Detect contradictions across the request + answers (plan §1 cap 2). Deterministic, pure.
 * Examples: read-only + execute/mutate · no-network + scrape the web · generic + measurable.
 * Returns human-readable strings (empty when none). A contradiction BLOCKS SPEC_READY.
 */
export function detectContradictions(request: string, answers: InterrogationAnswer[] = []): string[] {
  const text = corpus(request, answers);
  const found: string[] = [];

  const saysReadOnly = has(text, "read-only", "read only", "readonly", "no mutation", "no writes", "never writes", "propose-only", "propose only");
  const saysMutate = has(text, "execute", "mutate", "write to", "delete", "send ", "deploy", "modify", "update the", "change the state", "auto-apply", "automatically apply");
  if (saysReadOnly && saysMutate) {
    found.push("Contradiction: declared read-only / propose-only yet also asks to execute or mutate state.");
  }

  const saysNoNetwork = has(text, "no network", "offline", "no external", "no internet", "local only", "local-only");
  const saysScrape = has(text, "scrape", "crawl", "fetch from the web", "browse the web", "hit the api", "call the api", "live web", "from the internet");
  if (saysNoNetwork && saysScrape) {
    found.push("Contradiction: declared no-network / offline yet also asks to scrape or fetch from the web.");
  }

  const saysGeneric = isGeneric(request) || has(text, "general purpose", "general-purpose", "do everything", "anything");
  const saysMeasurable = has(text, "measurable", "threshold", "%", "percent", "at least", "exactly", "per day", "per week") || /\b\d+\b/.test(answerFor(answers, MEASURABLE_CRITERIA_QUESTION_ID));
  if (saysGeneric && saysMeasurable) {
    found.push("Contradiction: a generic 'do everything' scope cannot also have a single measurable acceptance criterion.");
  }

  const saysNoLlm = has(text, "no llm", "no ai", "deterministic only", "rule-based only", "rules only", "no model");
  const saysLlm = has(text, "use an llm", "use ai", "gpt", "language model", "summarize with ai", "ai-generated", "ask the model");
  if (saysNoLlm && saysLlm) {
    found.push("Contradiction: declared no-LLM / rule-based only yet also asks to use an LLM/AI.");
  }

  return found;
}

// ─── Readiness assessment ───────────────────────────────────────────────────────

/**
 * Which REQUIRED interrogation items are still unanswered.
 *
 * Mirrors `research-job.ts` semantics: with NO answers supplied (the freshly-interrogated
 * case) it returns every required id, so the verdict is NEEDS_INTERROGATION until Hart
 * starts answering. An answer counts only if it is non-empty.
 */
function unansweredRequired(questions: InterrogationItem[], answers: InterrogationAnswer[]): string[] {
  const answered = new Set(answers.filter((a) => a.answer.trim().length > 0).map((a) => a.questionId));
  return questions.filter((q) => q.required && !answered.has(q.id)).map((q) => q.id);
}

/** Spec-lock dimension ids still undefined (no non-empty answer captured). */
function undefinedDimensions(answers: InterrogationAnswer[]): SpecLockDimension[] {
  const answered = new Set(answers.filter((a) => a.answer.trim().length > 0).map((a) => a.questionId));
  return SPEC_LOCK_DIMENSIONS.filter((d) => !answered.has(d));
}

/** A measurable-criteria answer is present when its question has a non-empty answer. */
function measurableCriteriaPresent(answers: InterrogationAnswer[]): boolean {
  return answers.some((a) => a.questionId === MEASURABLE_CRITERIA_QUESTION_ID && a.answer.trim().length > 0);
}

/** Whether the strategy verdict + risk are acceptable to even consider spec-readiness. */
function strategyBlocks(strategy: StrategyReviewResult): boolean {
  return strategy.verdict === "DO_NOT_BUILD" || strategy.risk === "high";
}

/**
 * Assess spec readiness (plan §1 cap 2). Pure + deterministic; time is INJECTED.
 *
 * Verdict ladder (gates win top-down):
 *   1. vague     → REFUSE_VAGUE
 *   2. generic   → REFUSE_GENERIC
 *   3. any required item unanswered / a dimension undefined / no measurable criteria →
 *      NEEDS_INTERROGATION
 *   4. strategy DO_NOT_BUILD or high risk, OR a contradiction → NEEDS_RISK_REVIEW
 *   5. otherwise → SPEC_READY (ready for HART to approve — never self-approved).
 *
 * SPEC_READY requires ALL of: required answered + measurable criteria present + five
 * dimensions defined + no contradiction + strategy not DO_NOT_BUILD + risk acceptable.
 */
export function assessSpecReadiness(
  request: string,
  answers: InterrogationAnswer[] = [],
  opts: AssessSpecReadinessOptions = {},
): SpecReadinessResult {
  const assessedAt = opts.now ?? DEFAULT_NOW;
  const capturedAnswers = opts.answers ?? answers;
  const classification = classifyRequest(request);
  const strategy = reviewStrategy(request);
  const interrogation = interrogateSpec(request, { answers: capturedAnswers });

  const unansweredRequiredIds = unansweredRequired(interrogation.questions, capturedAnswers);
  const undefinedDimensionIds = undefinedDimensions(capturedAnswers);
  const criteriaPresent = measurableCriteriaPresent(capturedAnswers);
  const contradictions = detectContradictions(request, capturedAnswers);

  const allRequiredAnswered = unansweredRequiredIds.length === 0;

  const base = {
    request,
    classification,
    strategy,
    interrogation,
    unansweredRequiredIds,
    allRequiredAnswered,
    measurableCriteriaPresent: criteriaPresent,
    undefinedDimensionIds,
    contradictions,
    assessedAt,
    selfApproved: false as const,
  };

  // 1 + 2: refuse vague / generic BEFORE asking anything more of Hart.
  if (isVague(request)) {
    return {
      ...base,
      readiness: "REFUSE_VAGUE",
      reason:
        "Request is too vague to interrogate — the Factory cannot build from vague intent. " +
        "Describe a specific, repeated problem this agent would solve.",
    };
  }
  if (isGeneric(request)) {
    return {
      ...base,
      readiness: "REFUSE_GENERIC",
      reason:
        "Request describes a generic 'do everything' agent with no concrete value anchor — refused. " +
        "Name one specific problem and a measurable outcome instead.",
    };
  }

  // 3: interrogation gate — required items, the five dimensions, and measurable criteria.
  if (!allRequiredAnswered || undefinedDimensionIds.length > 0 || !criteriaPresent) {
    const missingBits: string[] = [];
    if (!allRequiredAnswered) missingBits.push(`${unansweredRequiredIds.length} required question(s) unanswered`);
    if (undefinedDimensionIds.length > 0) missingBits.push(`${undefinedDimensionIds.length} spec-lock dimension(s) undefined (${undefinedDimensionIds.join(", ")})`);
    if (!criteriaPresent) missingBits.push("no measurable acceptance criteria");
    return {
      ...base,
      readiness: "NEEDS_INTERROGATION",
      reason: `Interrogation incomplete: ${missingBits.join("; ")}. Answer the required questions before spec-lock.`,
    };
  }

  // 4: risk / strategy / contradiction review — fully interrogated but not yet safe to lock.
  if (contradictions.length > 0 || strategyBlocks(strategy)) {
    const why: string[] = [];
    if (contradictions.length > 0) why.push(`${contradictions.length} contradiction(s): ${contradictions.join(" ")}`);
    if (strategy.verdict === "DO_NOT_BUILD") why.push(`strategy verdict DO_NOT_BUILD — ${strategy.reason}`);
    else if (strategy.risk === "high") why.push(`strategy risk is high — ${strategy.reason}`);
    return {
      ...base,
      readiness: "NEEDS_RISK_REVIEW",
      reason: `Fully interrogated, but not ready to lock: ${why.join("; ")}.`,
    };
  }

  // 5: ready for HART to approve — the Factory NEVER self-approves.
  return {
    ...base,
    readiness: "SPEC_READY",
    reason:
      "All required questions answered, measurable criteria + five spec-lock dimensions defined, " +
      "no contradictions, strategy/risk acceptable. Ready for Hart to approve the spec (NOT approved — the Factory never self-approves).",
  };
}
