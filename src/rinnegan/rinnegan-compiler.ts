/**
 * src/rinnegan/rinnegan-compiler.ts
 *
 * The PURE Rinnegan compiler. Scores vault notes by relevance to the intent, tags freshness
 * (stale notes down-weighted, never laundered), folds in live facts + memory patterns + recent
 * proposals, ranks everything kind-weighted, and caps to a compact briefing. Deterministic.
 */

import type {
  CompiledContext,
  ContextItem,
  ContextKind,
  RinneganInputs,
  RinneganNote,
} from "./rinnegan-types.js";
import { buildBriefingPack, briefingPackToText } from "./briefing-pack.js";

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "do", "does", "did", "what", "how", "why", "when",
  "my", "our", "in", "on", "of", "to", "for", "and", "or", "i", "me", "we", "should", "need",
  "any", "this", "that", "with", "at", "it", "be", "can", "you", "your", "have", "has",
]);

function terms(s: string): string[] {
  return [...new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOPWORDS.has(t)))];
}

const STALE_DAYS = 180;

function isStale(note: RinneganNote, nowMs: number): boolean {
  if (note.reviewBy && Number.isFinite(Date.parse(note.reviewBy)) && Date.parse(note.reviewBy) < nowMs) return true;
  if (!note.reviewBy && note.ageDays != null && note.ageDays > STALE_DAYS) return true;
  return false;
}

function noteKind(relPath: string, tags: string[]): ContextKind {
  const p = relPath.toLowerCase();
  const t = tags.join(" ").toLowerCase();
  if (/doctrine|vision|blueprint/.test(p) || /doctrine|vision/.test(t)) return "doctrine";
  if (/roadmap|plan/.test(p) || /plan|roadmap/.test(t)) return "plan";
  return "note";
}

/** Dossier-aware snippet: substance for a dossier (briefing pack), plain snippet otherwise. */
function dossierSnippet(n: RinneganNote, max: number): string {
  const pack = buildBriefingPack({ relPath: n.relPath, title: n.title, tags: n.tags, body: n.body }, { budget: max });
  return pack.type !== "note" ? briefingPackToText(pack) : snippet(n.body, max);
}

/** Strip frontmatter + provenance callout, collapse whitespace, truncate. */
function snippet(body: string, max = 240): string {
  let b = body.replace(/^---[\s\S]*?---\s*/m, "").replace(/^>\s*\[!info\][^\n]*\n+/m, "").trim();
  b = b.replace(/\s+/g, " ");
  return b.length > max ? `${b.slice(0, max)}…` : b;
}

/** Weighted keyword overlap, normalised toward 0..1. */
function scoreNote(intentTerms: string[], note: RinneganNote): number {
  if (intentTerms.length === 0) return 0;
  const title = note.title.toLowerCase();
  const tags = note.tags.join(" ").toLowerCase();
  const body = note.body.toLowerCase();
  let s = 0;
  for (const t of intentTerms) {
    if (title.includes(t)) s += 3;
    if (tags.includes(t)) s += 2;
    else if (body.includes(t)) s += 1;
  }
  return s / (intentTerms.length * 3);
}

const KIND_WEIGHT: Record<ContextKind, number> = {
  doctrine: 1.0,
  fact: 1.0,
  plan: 0.9,
  pattern: 0.8,
  note: 0.7,
  proposal: 0.6,
};

export interface CompileOptions {
  /** Max vault notes to include (default 5). */
  maxNotes?: number;
  /** Max total items in the briefing (default 12). */
  maxItems?: number;
  /**
   * Per-note snippet length (default 240 — a teaser). For an LLM briefing, pass a larger value so
   * the model sees a dossier's SUBSTANCE (findings/opportunities), not just its framing/intro.
   */
  noteSnippetMax?: number;
}

export function compileContext(inputs: RinneganInputs, opts: CompileOptions = {}): CompiledContext {
  const maxNotes = opts.maxNotes ?? 5;
  const maxItems = opts.maxItems ?? 12;
  const noteSnippetMax = opts.noteSnippetMax ?? 240;
  const nowMs = Date.parse(inputs.now);
  const intentTerms = terms(inputs.intent);

  const noteItems: ContextItem[] = (inputs.notes ?? [])
    .map((n) => {
      const stale = isStale(n, nowMs);
      const relevance = scoreNote(intentTerms, n) * (stale ? 0.5 : 1); // down-weight stale, never launder
      return { n, stale, relevance };
    })
    .filter((x) => x.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, maxNotes)
    .map(
      (x): ContextItem => ({
        kind: noteKind(x.n.relPath, x.n.tags),
        title: x.n.title,
        // Dossiers get their SUBSTANCE (key findings/recommendations) via the briefing pack, not a
        // blind first-N-chars truncation; other notes keep the plain snippet.
        snippet: dossierSnippet(x.n, noteSnippetMax),
        source: `obsidian:${x.n.relPath}`,
        freshness: x.stale ? "STALE (review overdue)" : "current",
        relevance: Math.round(x.relevance * 100) / 100,
      }),
    );

  const factItems: ContextItem[] = (inputs.facts ?? []).map((f) => ({
    kind: "fact",
    title: f.label,
    snippet: f.value,
    source: f.source,
    freshness: f.freshness ?? "live",
    relevance: 1,
  }));
  const patternItems: ContextItem[] = (inputs.patterns ?? []).map((p) => ({
    kind: "pattern",
    title: p.subject,
    snippet: p.evidence,
    source: "executive-memory",
    freshness: "history",
    relevance: 0.8,
  }));
  const proposalItems: ContextItem[] = (inputs.proposals ?? []).map((p) => ({
    kind: "proposal",
    title: p.title,
    snippet: `status: ${p.status}`,
    source: `proposal:${p.id}`,
    freshness: "live",
    relevance: 0.6,
  }));

  const items = [...factItems, ...noteItems, ...patternItems, ...proposalItems]
    .sort((a, b) => b.relevance * KIND_WEIGHT[b.kind] - a.relevance * KIND_WEIGHT[a.kind])
    .slice(0, maxItems);

  const byKind = items.reduce<Record<string, number>>((m, i) => {
    m[i.kind] = (m[i.kind] ?? 0) + 1;
    return m;
  }, {});
  const note =
    items.length === 0
      ? "No relevant context compiled (no matching notes/facts)."
      : `${items.length} item(s): ${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(", ")}.` +
        (items.some((i) => i.freshness.startsWith("STALE")) ? " Some notes are STALE — flagged + down-weighted." : "");

  return { intent: inputs.intent, items, note };
}

/** Render the compiled context as a briefing block to hand the LLM Ask as grounding. */
export function toBriefing(ctx: CompiledContext): string {
  if (ctx.items.length === 0) return "";
  const lines = [`Compiled briefing for: "${ctx.intent}"`];
  for (const i of ctx.items) {
    const stale = i.freshness.startsWith("STALE") ? " · STALE" : "";
    lines.push(`- [${i.kind}${stale}] ${i.title}: ${i.snippet}  (src: ${i.source})`);
  }
  return lines.join("\n");
}
