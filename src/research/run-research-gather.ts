/**
 * src/research/run-research-gather.ts — the NODE host edge for research gathering.
 *
 * Builds a real SourceFetcher backed by the governed LlmGateway. This is the ONLY research module
 * permitted to import the gateway (it pulls node:path → Worker-unsafe); the orchestrator
 * (research-gatherer.ts) stays pure and takes the fetcher injected.
 *
 * Triple fail-closed gate before a single real call happens:
 *   1. the job's BoundaryDefinition must permit network + LLM (checked by gatherSources),
 *   2. HARTOS_RESEARCH_GATHER=true must arm gathering (this module's flag),
 *   3. the gateway self-gates the actual provider — real OpenAI only when
 *      HARTOS_LLM_PROVIDER=openai AND HARTOS_LLM_ENABLE_NETWORK=true AND OPENAI_API_KEY present;
 *      otherwise it runs deterministic, which llmResultToSources REFUSES to cite as a source.
 *
 * It reaches the model through a research-tuned FREE-TEXT call (research-llm.ts) — NOT the Ask
 * gateway's ops-grounded structured contract, which would misframe + truncate open research.
 * Sources are honestly labelled "model knowledge (not web-verified)" and a single model source
 * caps synthesis at medium confidence. A web-fetch fetcher can slot behind the same port later.
 */

import { buildResearchInfer, type ResearchInfer } from "./research-llm.js";
import type { SourceFetcher } from "./research-gatherer.js";

type Env = Record<string, string | undefined>;

/** The research-specific arm flag (on top of the LLM gate). Default OFF. */
export const RESEARCH_GATHER_FLAG = "HARTOS_RESEARCH_GATHER";

export function researchGatherArmed(env: Env = process.env): boolean {
  return String(env[RESEARCH_GATHER_FLAG] ?? "").trim().toLowerCase() === "true";
}

export interface BuildFetcherOptions {
  topic: string;
  now: string;
  env?: Env;
  /** Inject a fake infer in tests so no real network occurs; defaults to the gated research infer. */
  infer?: ResearchInfer;
}

/**
 * A SourceFetcher that asks a real model (gated) for grounded knowledge per sub-question and turns
 * the free-text answer into ONE cited source. The infer self-gates (provider/network/key) and
 * returns null when no real model answered → an honest unknown, never a fabricated source.
 */
export function buildLlmSourceFetcher(opts: BuildFetcherOptions): SourceFetcher {
  const infer: ResearchInfer = opts.infer ?? buildResearchInfer(opts.env);
  return async (subQuestion, index) => {
    const r = await infer(subQuestion, opts.topic);
    if (!r) return []; // no real model answer ⇒ honest unknown
    return [
      {
        ref: `llm:${r.model}`,
        title: `Model knowledge (${r.model}, not web-verified)`,
        content: r.content,
        answers: [index],
        asOf: opts.now,
      },
    ];
  };
}
