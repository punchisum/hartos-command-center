/**
 * src/research/research-gatherer.ts — the GATED gathering edge (pure orchestration + port).
 *
 * The synthesis core consumes GatheredSource[] but never fetches. This module is the boundary
 * between "plan" and "gather": it pre-flights the job's BoundaryDefinition through the SAME proven
 * gate the runtime enforces (checkBoundary), refuses up front if the boundary denies network/LLM,
 * honours a fail-closed arm flag, then drives an INJECTED SourceFetcher per sub-question. The
 * fetcher (the actual web/LLM call) is the Node host edge — this module stays pure + Worker-safe.
 *
 * Honesty floor (the rules that keep "research" from becoming fabrication):
 *   - Boundary denies network/LLM ⇒ refuse, fetch nothing.
 *   - Not armed (flag off, default) ⇒ fetch nothing; synthesis then yields honest unknowns.
 *   - A DETERMINISTIC/fallback LLM result is NOT a source — only a real model (mode "openai")
 *     counts (see llmResultToSources). A stub answer must never be cited as research.
 *   - A fetcher that throws becomes a NOTE, never a fabricated source.
 *
 * Pure: no fs / network / clock / env. The fetcher + `now` + `armed` are injected.
 */

import { checkBoundary, type BoundaryUsage } from "./boundary-gate.js";
import type { BoundaryDefinition } from "./agent-job-types.js";
import type { ResearchPlan } from "./research-planner.js";
import type { GatheredSource } from "./research-synthesis.js";
import type { LlmResult } from "../llm/llm-types.js";

/** The injected capability that actually fetches material for one sub-question (the host edge). */
export type SourceFetcher = (subQuestion: string, index: number) => Promise<GatheredSource[]>;

export interface GatherOptions {
  boundary: BoundaryDefinition;
  fetcher: SourceFetcher;
  now: string;
  /** Fail-closed: gathering only runs when explicitly armed. Default false ⇒ honest empty. */
  armed?: boolean;
}

export interface GatherResult {
  sources: GatheredSource[];
  /** Honest per-step log (gathered N / refused / failed / skipped). */
  notes: string[];
  /** True iff the boundary refused gathering before any fetch. */
  refused: boolean;
  denials: string[];
}

/**
 * Turn one LLM result into research sources — the HONESTY GATE for model-backed gathering.
 * Returns a source ONLY when a real model answered (mode "openai") with non-empty text; a
 * deterministic/fallback stub yields [] (it is not evidence). Pure + testable without a gateway.
 */
export function llmResultToSources(
  result: LlmResult | null,
  subQuestion: string,
  index: number,
  now: string,
): GatheredSource[] {
  if (!result || result.mode !== "openai" || result.success !== true) return [];
  const answer = (result.output?.summary ?? "").trim();
  if (!answer) return [];
  return [
    {
      ref: `llm:${result.model}`,
      title: `Model knowledge (${result.model}, not web-verified)`,
      content: answer,
      answers: [index],
      asOf: now,
    },
  ];
}

/**
 * Gather sources for a plan within its boundary. Pure orchestration: pre-flight the boundary,
 * honour the arm flag, then drive the injected fetcher per sub-question — never throwing, never
 * fabricating. Returns the gathered sources + an honest log of what happened.
 */
export async function gatherSources(plan: ResearchPlan, opts: GatherOptions): Promise<GatherResult> {
  // 1. Boundary pre-flight — gathering reaches the network + an LLM; if the boundary denies those
  //    (the fail-closed default for any agent that didn't declare them), refuse up front.
  const usage: BoundaryUsage = { usesExternalNetwork: true, usesLlm: true, searchDepth: 1 };
  const gate = checkBoundary(usage, opts.boundary);
  if (!gate.allowed) {
    return {
      sources: [],
      notes: [`Boundary refused gathering: ${gate.denials.join("; ")}. Nothing fetched.`],
      refused: true,
      denials: gate.denials,
    };
  }

  // 2. Arm flag — fail-closed. With gathering disarmed, synthesis becomes honest unknowns.
  if (!opts.armed) {
    return {
      sources: [],
      notes: ["Gathering not armed (flag off) — no sources fetched; the dossier will be honest unknowns."],
      refused: false,
      denials: [],
    };
  }

  // 3. Drive the fetcher per sub-question. A failure is a note, never a fabricated source.
  const sources: GatheredSource[] = [];
  const notes: string[] = [];
  for (let i = 0; i < plan.subQuestions.length; i++) {
    try {
      const got = await opts.fetcher(plan.subQuestions[i], i);
      sources.push(...got);
      notes.push(`sub-question ${i + 1}/${plan.subQuestions.length}: gathered ${got.length} source(s).`);
    } catch (e) {
      notes.push(`sub-question ${i + 1}/${plan.subQuestions.length}: fetch failed (${e instanceof Error ? e.message : String(e)}) — left as an unknown.`);
    }
  }
  return { sources, notes, refused: false, denials: [] };
}
