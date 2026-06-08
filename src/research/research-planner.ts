/**
 * src/research/research-planner.ts
 *
 * Phase F1 — the Research Agent's deterministic core ("the intelligence supply
 * line"). PURE and fs/network-free, in the Phase A/B/E reasoning style: a research
 * QUESTION in, a structured PLAN out. It decomposes the question into sub-questions
 * + the inputs that would have to be gathered, and is scrupulously honest — it
 * NEVER fabricates findings. The actual answers are explicit `unknowns` that a
 * later (gated) gathering step must fill. An LLM may later narrate the plan; the
 * structure here is computed from the question alone.
 */

export type ResearchVerdict = "READY_TO_RESEARCH" | "NEEDS_SCOPING" | "TOO_BROAD";
export type ResearchRisk = "low" | "medium" | "high";
export type ResearchShape = "comparison" | "decision" | "landscape" | "howto" | "definition" | "open";

export interface ResearchPlan {
  /** The cleaned research question (topic phrasing preserved). */
  question: string;
  /** The detected research shape, which drives the decomposition. */
  shape: ResearchShape;
  verdict: ResearchVerdict;
  risk: ResearchRisk;
  /** Deterministic decomposition into answerable sub-questions. */
  subQuestions: string[];
  /** What data/sources a gathering step would need (heuristic, never invented data). */
  requiredInputs: string[];
  /** What the plan can assert structurally (not the answers). */
  knowns: string[];
  /** What is NOT known and must be gathered — answers are never fabricated. */
  unknowns: string[];
  recommendedNextAction: string;
  /** Deterministic, fact-based explanation of the verdict (not an LLM voice). */
  reason: string;
}

const STOP_LEAD = /^(please\s+)?(research|look into|find out(\s+about)?|investigate|explore|study|dig into|tell me about)\s+/i;

/** Normalize whitespace + strip a leading research verb, preserving the topic + any "?". */
function normalize(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().replace(STOP_LEAD, "").trim();
}

/** A short topic phrase for templating sub-questions (no trailing punctuation). */
function topicOf(question: string): string {
  const t = question.replace(/[?.!]+$/g, "").trim();
  return t.length > 0 ? t : "the topic";
}

function has(text: string, re: RegExp): boolean {
  return re.test(text);
}

function detectShape(q: string): ResearchShape {
  const t = q.toLowerCase();
  if (has(t, /\b(vs\.?|versus|compare|compared to|better than)\b/) || /\bor\b.*\?/.test(t)) return "comparison";
  if (has(t, /\b(should (i|we)|is it worth|worth (it|building|doing)|feasible|viable|can (i|we)|do we need)\b/)) return "decision";
  if (has(t, /\b(landscape|options|alternatives|what's out there|whats out there|market for|tools for|ways to|approaches to)\b/)) return "landscape";
  if (has(t, /\b(how (to|do|can|should)|steps to|guide to|set up|implement)\b/)) return "howto";
  if (has(t, /\b(what is|what are|what's|whats|explain|understand|meaning of|definition of)\b/)) return "definition";
  return "open";
}

function subQuestionsFor(shape: ResearchShape, topic: string): string[] {
  switch (shape) {
    case "comparison":
      return [
        `What exactly are the candidates being compared for ${topic}?`,
        `Which dimensions actually matter here (cost, fit, risk, effort)?`,
        `How does each candidate score on those dimensions?`,
        `What are the key trade-offs?`,
        `Which is recommended, and under what conditions?`,
      ];
    case "decision":
      return [
        `What outcome / success criteria define ${topic}?`,
        `What approaches or options exist?`,
        `What does each cost in time, money, and risk?`,
        `What are the main risks and unknowns?`,
        `What is the recommended path, and what would change it?`,
      ];
    case "landscape":
      return [
        `What is the scope and boundary of ${topic}?`,
        `Who/what are the main options or players?`,
        `How do they differ on the axes that matter?`,
        `Where are the gaps or opportunities?`,
        `What is worth pursuing first?`,
      ];
    case "howto":
      return [
        `What is the concrete end goal for ${topic}?`,
        `What prerequisites / inputs are required?`,
        `What are the steps, in order?`,
        `What are the common pitfalls?`,
        `How do you verify it worked?`,
      ];
    case "definition":
      return [
        `What does ${topic} mean precisely?`,
        `Why does it matter / where is it used?`,
        `What are the key components or variants?`,
        `What are common misconceptions?`,
      ];
    case "open":
    default:
      return [
        `What precisely is being asked about ${topic}?`,
        `What is already known vs. assumed?`,
        `What evidence would answer it?`,
        `What does that evidence most likely show?`,
        `What is the conclusion or next step?`,
      ];
  }
}

interface InputSignal {
  re: RegExp;
  input: string;
  /** Raises the floor risk when matched. */
  risk?: ResearchRisk;
}
const INPUT_SIGNALS: InputSignal[] = [
  { re: /\b(cost|price|pricing|budget|\$|revenue|profit|roi)\b/i, input: "pricing / cost data" },
  { re: /\b(competitors?|competition|players|markets?|incumbents?)\b/i, input: "competitor & market data" },
  { re: /\b(users?|customers?|audience|demand|adoption|retention)\b/i, input: "user / demand evidence" },
  { re: /\b(apis?|integrations?|stack|technical|architecture|libraries|library|frameworks?|sdks?)\b/i, input: "technical docs / API references" },
  { re: /\b(legal|regulation|regulatory|compliance|licen[cs]e|tax|gdpr|privacy)\b/i, input: "regulatory / legal sources", risk: "high" },
  { re: /\b(security|vulnerab|threat|breach|auth)\b/i, input: "security references", risk: "medium" },
];

const RISK_ORDER: ResearchRisk[] = ["low", "medium", "high"];
function maxRisk(a: ResearchRisk, b: ResearchRisk): ResearchRisk {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

const BROAD = /\b(everything|all about|comprehensive (overview|guide)|the entire|whole (field|space|industry))\b/i;

/**
 * Plan (don't answer) a research question. Deterministic: same input → same plan.
 * The returned plan structures the work and names what must be gathered; it never
 * asserts findings it cannot compute from the question.
 */
export function planResearch(rawQuestion: string): ResearchPlan {
  const question = normalize(rawQuestion);
  const topic = topicOf(question);
  const wordCount = question.split(/\s+/).filter(Boolean).length;
  const shape = detectShape(question);

  // Required inputs: matched signals + a topic-grounded primary source. De-duped.
  let risk: ResearchRisk = shape === "decision" || /\b(\$|cost|price|invest)\b/i.test(question) ? "medium" : "low";
  const inputs: string[] = [];
  for (const sig of INPUT_SIGNALS) {
    if (sig.re.test(question)) {
      if (!inputs.includes(sig.input)) inputs.push(sig.input);
      if (sig.risk) risk = maxRisk(risk, sig.risk);
    }
  }
  inputs.push(`primary sources on ${topic}`);
  const requiredInputs = [...new Set(inputs)];

  // Verdict: honest about whether the question is researchable as stated.
  let verdict: ResearchVerdict;
  if (wordCount < 3 || topic === "the topic") verdict = "NEEDS_SCOPING";
  else if (BROAD.test(question) || (wordCount <= 4 && shape === "open" && !question.includes(" "))) verdict = "TOO_BROAD";
  else verdict = "READY_TO_RESEARCH";

  const subQuestions = subQuestionsFor(shape, topic);

  const knowns = [
    `The question is a ${shape}-shaped research request.`,
    `It decomposes into ${subQuestions.length} sub-question(s).`,
    `Answering it requires: ${requiredInputs.join("; ")}.`,
  ];
  // The answers themselves are unknown until gathered — never fabricated here.
  const unknowns = subQuestions.map((s) => `Unanswered until sources are gathered: ${s}`);

  let recommendedNextAction: string;
  let reason: string;
  if (verdict === "NEEDS_SCOPING") {
    recommendedNextAction = "Clarify the question — name a concrete topic and what decision/output it should inform.";
    reason = `NEEDS_SCOPING — the question is too thin (${wordCount} word(s)) to plan a useful inquiry.`;
  } else if (verdict === "TOO_BROAD") {
    recommendedNextAction = `Narrow the scope — pick one angle (e.g. "${subQuestions[0]}").`;
    reason = `TOO_BROAD — "${topic}" spans too much to research in one pass; split it.`;
  } else {
    recommendedNextAction = `Gather ${requiredInputs.join("; ")}; answer the sub-questions in order; then synthesize a verdict.`;
    reason = `READY_TO_RESEARCH — a ${shape}-shaped question with a clear topic; plan is structured and sources are identified (risk ${risk}).`;
  }

  return { question, shape, verdict, risk, subQuestions, requiredInputs, knowns, unknowns, recommendedNextAction, reason };
}
