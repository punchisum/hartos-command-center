/**
 * src/cockpit/control-surface/summarizer.ts
 *
 * Phase 18E — the LLM boundary. The model SELECTS (which facts to highlight),
 * SUMMARIZES (one prose line), EXPLAINS (the computed verdict), and may rewrite
 * the prose of fix recommendations. It does NOT — and structurally CANNOT — set
 * verdict, confidence, or severity: those are computed before this runs and are
 * never read back from the model's output.
 *
 * Three guarantees enforced in code (not by prompt):
 *   1. LLM-output isolation — verdict/confidence/severity come only from the
 *      computed bundle; any such fields a model returns are ignored.
 *   2. `unknown` honesty — when verdict === "UNKNOWN" the model is forbidden from
 *      summarizing over the gap; we force the "I can't assess …" line.
 *   3. Secret safety — the assembled summary/fixes are run through assertNoSecrets
 *      before they can be rendered or persisted.
 */

import { assertNoSecrets } from "../../llm/redaction.js";
import type { AgentFactBundle, Fact, FixRecommendation } from "./fact-bundle.js";
import { sortFixesBySeverity } from "./verdict-rules.js";

/**
 * What the model is asked to produce. NOTE: there is intentionally no verdict /
 * confidence / severity field here — the model is given those as inputs to
 * explain, and there is nowhere for it to return them.
 */
export interface SummaryDraft {
  /** Keys of up to 3 facts to highlight on the card (subset of the bundle). */
  selectedFactKeys: string[];
  /** One prose line summarizing the agent's state. */
  summaryText: string;
  /** Keys of the facts the prose leaned on. */
  citedFactKeys: string[];
  /** Explanation of the computed verdict (prose over the rule result). */
  whyVerdict: string;
  /** Prose overlay for the fixes, matched positionally to the computed seeds. */
  fixProse: Array<{ title?: string; why?: string }>;
}

/**
 * The input handed to a summarizer: facts + the ALREADY-COMPUTED verdict /
 * confidence, and the severity-tagged fix seeds. The summarizer explains; it does
 * not judge.
 */
export interface SummaryRequest {
  agentId: string;
  name: string;
  purpose: string;
  facts: Fact[];
  verdict: AgentFactBundle["verdict"];
  confidence: AgentFactBundle["confidence"];
  unavailable: boolean;
  /** Computed-severity fix seeds; the summarizer may only restyle their prose. */
  fixSeeds: FixRecommendation[];
}

/** A summarizer is any function from request → draft. Stub it in tests; no network. */
export type FactSummarizer = (req: SummaryRequest) => SummaryDraft | Promise<SummaryDraft>;

const CANT_ASSESS = (name: string) =>
  `I can't assess ${name} — data unavailable. No facts could be fetched, so there is nothing to summarize.`;

/**
 * Deterministic, offline summarizer (the default + the safe fallback). Selects the
 * three freshest non-null facts, writes a plain factual line, and passes fix prose
 * straight through. Never fabricates over an unknown bundle.
 */
export const deterministicSummarizer: FactSummarizer = (req) => {
  if (req.unavailable || req.verdict === "UNKNOWN") {
    return {
      selectedFactKeys: [],
      summaryText: CANT_ASSESS(req.name),
      citedFactKeys: [],
      whyVerdict: `Verdict UNKNOWN — the ${req.name} bundle could not be fetched, so no trustworthy summary is possible.`,
      fixProse: req.fixSeeds.map(() => ({})),
    };
  }

  const present = req.facts.filter((f) => f.value !== null);
  const top = present.slice(0, 3);
  const selectedFactKeys = top.map((f) => f.key);
  const summaryText =
    top.length > 0
      ? `${top.map((f) => `${f.label} ${f.value}${f.unit ? ` ${f.unit}` : ""}`).join(", ")}.`
      : `${req.name} has no highlighted facts.`;
  const whyVerdict = `Verdict ${req.verdict} (${req.confidence} confidence) — computed from ${present.length} fact(s) over the freshness rule.`;

  return {
    selectedFactKeys,
    summaryText,
    citedFactKeys: selectedFactKeys,
    whyVerdict,
    fixProse: req.fixSeeds.map(() => ({})),
  };
};

/**
 * Apply a summarizer's draft onto a computed bundle, enforcing all three
 * guarantees. Returns the same bundle, mutated in place, with `summary`,
 * `whyVerdict`, `selectedFactKeys`, and prose-overlaid `fixes` populated.
 *
 * `now` stamps the summary; `summary.stale` is set if the summary is older than
 * the freshest fact it describes.
 */
export async function applySummary(
  bundle: AgentFactBundle,
  summarizer: FactSummarizer,
  now: string
): Promise<AgentFactBundle> {
  let draft: SummaryDraft;
  try {
    draft = await summarizer({
      agentId: bundle.agentId,
      name: bundle.name,
      purpose: bundle.purpose,
      facts: bundle.facts,
      verdict: bundle.verdict,
      confidence: bundle.confidence,
      unavailable: bundle.unavailable,
      fixSeeds: bundle.fixes,
    });
  } catch {
    // A throwing/misbehaving model never blocks the surface — fall back to deterministic.
    draft = (await deterministicSummarizer({
      agentId: bundle.agentId,
      name: bundle.name,
      purpose: bundle.purpose,
      facts: bundle.facts,
      verdict: bundle.verdict,
      confidence: bundle.confidence,
      unavailable: bundle.unavailable,
      fixSeeds: bundle.fixes,
    })) as SummaryDraft;
  }

  // ── Guarantee 2: unknown honesty. The model is forbidden from filling the gap. ──
  if (bundle.unavailable || bundle.verdict === "UNKNOWN") {
    bundle.selectedFactKeys = [];
    bundle.whyVerdict = `Verdict UNKNOWN — the ${bundle.name} bundle could not be fetched. I can't assess ${bundle.name}.`;
    bundle.summary = {
      text: CANT_ASSESS(bundle.name),
      generatedAt: now,
      citedFactKeys: [],
      stale: false,
    };
    // Fix seeds keep their computed severity; prose is left as-is (deterministic).
    bundle.fixes = sortFixesBySeverity(bundle.fixes);
    assertNoSecrets({ summary: bundle.summary, whyVerdict: bundle.whyVerdict, fixes: bundle.fixes }, `bundle:${bundle.agentId}`);
    return bundle;
  }

  // ── Guarantee 1: isolation. Only prose/selection are taken from the draft. ──
  const validKeys = new Set(bundle.facts.map((f) => f.key));
  bundle.selectedFactKeys = (draft.selectedFactKeys ?? [])
    .filter((k) => validKeys.has(k))
    .slice(0, 3);
  bundle.whyVerdict = typeof draft.whyVerdict === "string" && draft.whyVerdict.trim() ? draft.whyVerdict : "";

  const citedFactKeys = (draft.citedFactKeys ?? []).filter((k) => validKeys.has(k));
  // Summary freshness: stale if the summary post-dates the freshest fact it cited.
  const newestCited = citedFactKeys
    .map((k) => bundle.facts.find((f) => f.key === k)?.asOf)
    .filter((a): a is string => Boolean(a))
    .map((a) => Date.parse(a))
    .filter((n) => !Number.isNaN(n));
  const summaryAt = Date.parse(now);
  const freshestFactAt = newestCited.length ? Math.max(...newestCited) : null;
  const stale = freshestFactAt !== null && !Number.isNaN(summaryAt) ? summaryAt < freshestFactAt : false;

  bundle.summary = {
    text: typeof draft.summaryText === "string" ? draft.summaryText : "",
    generatedAt: now,
    citedFactKeys,
    stale,
  };

  // Fixes: COMPUTED severity + action stay; only title/why prose may be overlaid.
  const overlaid: FixRecommendation[] = bundle.fixes.map((seed, i) => {
    const prose = draft.fixProse?.[i] ?? {};
    return {
      severity: seed.severity, // computed — never from the model
      action: seed.action, // computed kind+payload — never from the model
      title: typeof prose.title === "string" && prose.title.trim() ? prose.title : seed.title,
      why: typeof prose.why === "string" && prose.why.trim() ? prose.why : seed.why,
    };
  });
  bundle.fixes = sortFixesBySeverity(overlaid);

  // ── Guarantee 3: secret safety. Refuse to ship a bundle carrying a raw secret. ──
  assertNoSecrets(
    { summary: bundle.summary, whyVerdict: bundle.whyVerdict, facts: bundle.facts, fixes: bundle.fixes },
    `bundle:${bundle.agentId}`
  );

  return bundle;
}
