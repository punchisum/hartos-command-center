/**
 * src/rinnegan/rinnegan-types.ts
 *
 * Rinnegan = the CONTEXT COMPILER (not a reasoner). Given an intent, it assembles a compact,
 * ranked, freshness-tagged briefing from the knowledge stores — Obsidian notes (meaning), live
 * read-model facts, executive-memory patterns, recent proposals — and hands it to the LLM Ask so
 * HartOS reasons like a deeply-briefed operator. The LLM reasons; Rinnegan curates.
 *
 * This module is the pure CONTRACT. The compiler (rinnegan-compiler.ts) is pure + deterministic;
 * the host (scripts/rinnegan-compile.ts) gathers the raw materials. Honesty floor: stale notes are
 * tagged STALE and down-weighted — never laundered into prime context.
 */

export type ContextKind = "doctrine" | "plan" | "fact" | "pattern" | "note" | "proposal";

/** A vault note as the host hands it in (already read from disk). */
export interface RinneganNote {
  relPath: string;
  title: string;
  tags: string[];
  body: string;
  reviewBy?: string | null;
  ageDays?: number | null;
}

export interface RinneganFact {
  label: string;
  value: string;
  source: string;
  freshness?: string;
}

export interface RinneganPattern {
  subject: string;
  evidence: string;
}

export interface RinneganProposalRef {
  id: string;
  title: string;
  status: string;
}

/** Raw materials the host gathers for one compilation. */
export interface RinneganInputs {
  intent: string;
  /** Injected ISO now (for note staleness). */
  now: string;
  notes?: RinneganNote[];
  facts?: RinneganFact[];
  patterns?: RinneganPattern[];
  proposals?: RinneganProposalRef[];
}

/** One ranked, freshness-tagged item in the compiled briefing. */
export interface ContextItem {
  kind: ContextKind;
  title: string;
  snippet: string;
  source: string;
  freshness: string;
  /** 0..1 relevance to the intent (already kind-weighted at ranking time, surfaced raw here). */
  relevance: number;
}

export interface CompiledContext {
  intent: string;
  /** Ranked, capped items (worst dropped). */
  items: ContextItem[];
  /** Honest one-line summary (counts by kind; flags if any stale items were included). */
  note: string;
}
