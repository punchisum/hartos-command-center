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
 * v1 reaches the model through the gateway's `summarizeDataSnapshot` capability — sources are
 * honestly labelled "model knowledge (not web-verified)" and a single model source caps the
 * synthesis at medium confidence. A dedicated web-fetch fetcher can be added behind the same port.
 */

import { LlmGateway, type LlmGatewayOptions } from "../llm/llm-gateway.js";
import { redact, redactDeep } from "../llm/redaction.js";
import { llmResultToSources, type SourceFetcher } from "./research-gatherer.js";

type Env = Record<string, string | undefined>;

/** The research-specific arm flag (on top of the gateway's own gate). Default OFF. */
export const RESEARCH_GATHER_FLAG = "HARTOS_RESEARCH_GATHER";

export function researchGatherArmed(env: Env = process.env): boolean {
  return String(env[RESEARCH_GATHER_FLAG] ?? "").trim().toLowerCase() === "true";
}

export interface BuildFetcherOptions {
  topic: string;
  now: string;
  env?: Env;
  /** Provider overrides — tests inject mocks so no real network occurs. */
  providers?: LlmGatewayOptions["providers"];
  /** Pre-constructed gateway (takes precedence). */
  gateway?: LlmGateway;
}

/**
 * A SourceFetcher that asks the governed gateway for grounded knowledge per sub-question. The
 * request is redacted first (no secret reaches a prompt). Only a real model answer becomes a
 * source (llmResultToSources); a deterministic stub or a thrown error yields [] — honest unknowns.
 */
export function buildLlmSourceFetcher(opts: BuildFetcherOptions): SourceFetcher {
  const gateway =
    opts.gateway ??
    new LlmGateway({
      ...(opts.env ? { env: opts.env } : {}),
      ...(opts.providers ? { providers: opts.providers } : {}),
      writeUsage: false,
    });

  return async (subQuestion, index) => {
    const request = redact(
      `Research sub-question: ${subQuestion}\nTopic: ${opts.topic}\n` +
        `Answer factually and concisely from established knowledge. If you are not sure, say so rather than guessing — do not invent specifics.`,
    );
    const context = redactDeep({ topic: opts.topic, subQuestion });
    try {
      const result = await gateway.summarizeDataSnapshot(request, context);
      return llmResultToSources(result, subQuestion, index, opts.now);
    } catch {
      return []; // a failed call is an honest unknown, never a fabricated source
    }
  };
}
