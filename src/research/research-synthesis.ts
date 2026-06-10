/**
 * src/research/research-synthesis.ts — the Research Agent's SYNTHESIS core (the missing half).
 *
 * `research-planner.ts` decomposes a question into sub-questions; `research-job.ts` wraps that in
 * a fail-closed, gated AgentJob. Neither produces an ANSWER. This module is the synthesis step: it
 * turns the plan + the (gated, injected) material a gathering step fetched into a structured
 * `ResearchDossier` — an executive summary, key findings that EACH cite a source, reusable
 * KNOWLEDGE ITEMS usable across the whole fleet, and an honest list of what is still unknown.
 *
 * Doctrine (the same honesty floor as the planner): findings are NEVER fabricated. A sub-question
 * with no gathered source bearing on it becomes an UNKNOWN, not a guessed answer. With nothing
 * gathered the dossier is all-unknowns at "unknown" confidence — an honest "I don't know yet",
 * never a synthetic answer. An LLM may later narrate the dossier; the STRUCTURE here is computed
 * deterministically from the plan + the cited sources alone.
 *
 * PURE + deterministic + Worker-safe: no fs / network / clock / LLM. Gathering is INJECTED
 * (`GatheredSource[]`) — the core never fetches; that is the gated host edge.
 */

import type { ResearchPlan } from "./research-planner.js";

export type ResearchConfidence = "high" | "medium" | "low" | "unknown";

/**
 * One source a (gated) gathering step actually fetched. Injected — the core never fetches. `answers`
 * names which sub-question indices the source bears on; an empty/absent `answers` means "general".
 */
export interface GatheredSource {
  /** Stable reference (url id / doc path / RPC name) — never a secret/token. */
  ref: string;
  title: string;
  /** Extracted text a finding can be grounded in + cite. */
  content: string;
  /** Indices into `plan.subQuestions` this source answers; [] / absent ⇒ general background. */
  answers?: number[];
  /** Honest as-of for the source (ISO) or null when unknown. */
  asOf?: string | null;
}

export interface KeyFinding {
  /** The sub-question this answers (verbatim from the plan). */
  question: string;
  /** The condensed answer (lead sentences) — for the one-screen summary. Grounded, never invented. */
  finding: string;
  /** The FULL grounded answer (the complete gathered prose) — for the full report. */
  detail: string;
  /** Source refs backing it (≥1; a finding with zero sources is an unknown, not a finding). */
  sources: string[];
  confidence: ResearchConfidence;
}

/**
 * A reusable knowledge unit — the "usable across HartOS" payload. A standalone, cited claim other
 * agents / the LLM Ask / future research can reuse without re-reading the whole dossier.
 */
export interface KnowledgeItem {
  claim: string;
  /** Where it applies (domains / decisions / agents). */
  appliesTo: string[];
  sources: string[];
  confidence: ResearchConfidence;
}

export interface ResearchDossier {
  question: string;
  shape: string;
  /** One-screen executive summary (computed; an LLM may re-voice it later). */
  executiveSummary: string[];
  keyFindings: KeyFinding[];
  /** Reusable knowledge for the fleet — the cross-HartOS payload. */
  knowledgeItems: KnowledgeItem[];
  /** Sub-questions still unanswered — honest, never fabricated. */
  unknowns: string[];
  sources: { ref: string; title: string; asOf: string | null }[];
  /** Overall confidence — derived from coverage, never asserted. */
  confidence: ResearchConfidence;
  /** Honest one-liner about coverage (answered / total / sources / unknown). */
  note: string;
}

export interface SynthesisOptions {
  now: string;
  /** Distinct sources needed for a finding to reach "high" confidence (default 2). */
  corroborationFloor?: number;
}

const CONF_RANK: Record<ResearchConfidence, number> = { unknown: 0, low: 1, medium: 2, high: 3 };

/** First sentence (or a trimmed clamp) of a source's content — deterministic, grounded condensation. */
function leadSentence(content: string): string {
  const clean = content.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const m = clean.match(/^(.{0,240}?[.!?])(\s|$)/);
  return (m ? m[1] : clean.slice(0, 240)).trim();
}

/** Condense the relevant sources into one grounded finding line (no fabrication — only their words). */
function condense(sources: GatheredSource[]): string {
  const leads = sources.map((s) => leadSentence(s.content)).filter(Boolean);
  const seen = new Set<string>();
  const uniq = leads.filter((l) => {
    const k = l.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return uniq.slice(0, 2).join(" ");
}

/** The sources bearing on sub-question `i` (explicit `answers`), plus general sources as fallback. */
function sourcesFor(i: number, gathered: GatheredSource[]): GatheredSource[] {
  const specific = gathered.filter((s) => (s.answers ?? []).includes(i));
  if (specific.length > 0) return specific;
  // General sources (no declared answers) can support any sub-question, but only as a fallback.
  return gathered.filter((s) => (s.answers ?? []).length === 0);
}

/**
 * Synthesize a ResearchDossier from the plan + the gathered (injected) sources. Pure +
 * deterministic. Honesty floor: any sub-question with no bearing source is an UNKNOWN; with nothing
 * gathered the dossier is all-unknowns at "unknown" confidence — never a fabricated answer.
 */
export function synthesizeResearch(
  plan: ResearchPlan,
  gathered: GatheredSource[],
  opts: SynthesisOptions,
): ResearchDossier {
  const floor = opts.corroborationFloor ?? 2;
  const keyFindings: KeyFinding[] = [];
  const unknowns: string[] = [];

  plan.subQuestions.forEach((question, i) => {
    const bearing = sourcesFor(i, gathered);
    const finding = condense(bearing);
    if (bearing.length === 0 || !finding) {
      unknowns.push(`Unanswered until sources are gathered: ${question}`);
      return;
    }
    const refs = [...new Set(bearing.map((s) => s.ref))];
    // Dedupe identical content (web gathering emits one source per cited URL, all sharing the
    // same answer) so the full detail isn't repeated N times — distinct refs still corroborate.
    const detail = [...new Set(bearing.map((s) => s.content.trim()).filter(Boolean))].join("\n\n");
    const confidence: ResearchConfidence = refs.length >= floor ? "high" : "medium";
    keyFindings.push({ question, finding, detail, sources: refs, confidence });
  });

  // Reusable knowledge: every grounded finding becomes a cross-fleet claim (medium/high only),
  // DEDUPED by claim text — the same fact reused across sub-questions is one knowledge atom, not
  // many ("understand better, not remember more"). Merge sources; keep the strongest confidence.
  const topic = plan.question;
  const byClaim = new Map<string, KnowledgeItem>();
  for (const f of keyFindings) {
    if (CONF_RANK[f.confidence] < CONF_RANK.medium) continue;
    const key = f.finding.toLowerCase().replace(/\s+/g, " ").trim();
    const existing = byClaim.get(key);
    if (existing) {
      existing.sources = [...new Set([...existing.sources, ...f.sources])];
      if (CONF_RANK[f.confidence] > CONF_RANK[existing.confidence]) existing.confidence = f.confidence;
    } else {
      byClaim.set(key, {
        claim: f.finding,
        appliesTo: [`research: ${topic}`, `${plan.shape} decisions`, "HartOS Ask / future research"],
        sources: [...f.sources],
        confidence: f.confidence,
      });
    }
  }
  const knowledgeItems: KnowledgeItem[] = [...byClaim.values()];

  const sources = gathered.map((s) => ({ ref: s.ref, title: s.title, asOf: s.asOf ?? null }));

  // Overall confidence is EARNED by coverage — never asserted.
  const answered = keyFindings.length;
  const total = plan.subQuestions.length;
  const highShare = total > 0 ? keyFindings.filter((f) => f.confidence === "high").length / total : 0;
  let confidence: ResearchConfidence;
  if (answered === 0) confidence = "unknown";
  else if (answered === total && highShare >= 0.5) confidence = "high";
  else if (answered >= Math.ceil(total / 2)) confidence = "medium";
  else confidence = "low";

  const executiveSummary =
    answered === 0
      ? [
          `No sources gathered for "${topic}" — nothing has been synthesized.`,
          `All ${total} sub-question(s) remain open. Findings are never fabricated.`,
        ]
      : [
          `"${topic}" (${plan.shape}) — answered ${answered}/${total} sub-question(s) from ${gathered.length} source(s).`,
          ...keyFindings.slice(0, 3).map((f) => `• ${f.finding} [${f.sources.join(", ")}]`),
          unknowns.length ? `Still open: ${unknowns.length} sub-question(s).` : "All sub-questions answered.",
        ];

  const note =
    answered === 0
      ? `UNKNOWN — 0/${total} answered; no sources gathered. Honest "not yet", not a blank verdict.`
      : `Answered ${answered}/${total} sub-question(s) from ${gathered.length} source(s); ${unknowns.length} unknown; ${knowledgeItems.length} reusable knowledge item(s).`;

  return { question: topic, shape: plan.shape, executiveSummary, keyFindings, knowledgeItems, unknowns, sources, confidence, note };
}

/** One-line, deterministic summary of a dossier (for embedding / the cockpit). */
export function summarizeDossier(d: ResearchDossier): string {
  return `Research "${d.question}": ${d.keyFindings.length} finding(s), ${d.knowledgeItems.length} knowledge item(s), ${d.unknowns.length} unknown — ${d.confidence} confidence.`;
}
