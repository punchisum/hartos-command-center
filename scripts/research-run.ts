/**
 * scripts/research-run.ts — run a LIVE (gated) research job through the Research Agent.
 *
 * plan → gather (gated edge) → synthesize → gated dossier note. Read-only + propose-only: it
 * fetches and reasons, then prints the dossier + a NON-EXECUTABLE Obsidian note proposal. Nothing
 * is written to the vault here (that needs Hart's approval + the armed writer).
 *
 * Gathering is fail-closed: with HARTOS_RESEARCH_GATHER unset (or the LLM gateway not armed) the
 * dossier is an honest "unknowns" — never a fabricated answer. To do a real run:
 *   HARTOS_RESEARCH_GATHER=true HARTOS_LLM_PROVIDER=openai HARTOS_LLM_ENABLE_NETWORK=true \
 *     OPENAI_API_KEY=… npm run research:run -- "compare Postgres and SQLite for an edge app"
 */

import { pathToFileURL } from "node:url";
import { planResearch } from "../src/research/research-planner.js";
import { gatherSources } from "../src/research/research-gatherer.js";
import { buildLlmSourceFetcher, researchGatherArmed, RESEARCH_GATHER_FLAG } from "../src/research/run-research-gather.js";
import { synthesizeResearch, summarizeDossier } from "../src/research/research-synthesis.js";
import { researchDossierNote } from "../src/research/research-dossier-note.js";
import { RESEARCH_AGENT_SPEC } from "../src/agents/research-agent-spec.js";
import { resolveLlmConfig } from "../src/llm/llm-gateway.js";

export async function runResearch(question: string, env: Record<string, string | undefined>, now: string): Promise<string[]> {
  const out: string[] = [];
  const push = (s = "") => out.push(s);

  const plan = planResearch(question);
  const cfg = resolveLlmConfig(env);
  const armed = researchGatherArmed(env);

  push(`\n=== Research run (read-only, propose-only) ===`);
  push(`Question: ${plan.question}`);
  push(`Plan: ${plan.shape} · ${plan.verdict} · ${plan.subQuestions.length} sub-question(s) · risk ${plan.risk}`);
  push(
    `Gating: ${RESEARCH_GATHER_FLAG}=${armed ? "true (armed)" : "off"} · LLM provider=${cfg.provider} · network=${cfg.networkEnabled} · key=${cfg.apiKeyPresent ? "present" : "absent"}`,
  );

  // Gather within the Research Agent's declared boundary (network + LLM are declared/gated there).
  const fetcher = buildLlmSourceFetcher({ topic: plan.question, now, env });
  const gathered = await gatherSources(plan, { boundary: RESEARCH_AGENT_SPEC.boundary, fetcher, now, armed });
  push(`\nGathering:`);
  for (const n of gathered.notes) push(`  - ${n}`);

  const dossier = synthesizeResearch(plan, gathered.sources, { now });
  push(`\n${summarizeDossier(dossier)}`);
  push(`Executive summary:`);
  for (const l of dossier.executiveSummary) push(`  ${l}`);
  if (dossier.keyFindings.length) {
    push(`Key findings:`);
    for (const f of dossier.keyFindings) push(`  • ${f.question}\n      ${f.finding}  [${f.confidence}; ${f.sources.join(", ")}]`);
  }
  if (dossier.knowledgeItems.length) {
    push(`Reusable knowledge (usable across HartOS):`);
    for (const k of dossier.knowledgeItems) push(`  • ${k.claim}  [${k.confidence}; ${k.sources.join(", ")}]`);
  }
  if (dossier.unknowns.length) {
    push(`Open questions (${dossier.unknowns.length}):`);
    for (const u of dossier.unknowns) push(`  - ${u}`);
  }

  const note = researchDossierNote(dossier, now);
  push(`\n--- Gated knowledge-loop output (non-executable proposal) ---`);
  push(`  note: "${note.title}" → ${note.folder} (type ${note.noteType}, ${note.confidence} confidence)`);
  push(`  approve + arm the Obsidian writer to file it; then Rinnegan briefs the LLM Ask on it.`);
  if (!armed || gathered.refused || dossier.confidence === "unknown") {
    push(
      `\n  (Honest read: ${gathered.refused ? "boundary refused gathering" : !armed ? "gathering disarmed" : "no real model sources"} — nothing fabricated. ` +
        `Arm with ${RESEARCH_GATHER_FLAG}=true + the LLM gateway to do a real run.)`,
    );
  }
  return out;
}

const invokedDirectly = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('Usage: npm run research:run -- "<your research question>"');
    process.exit(2);
  }
  runResearch(question, process.env, new Date().toISOString())
    .then((lines) => {
      for (const l of lines) console.log(l);
    })
    .catch((e) => {
      console.error(`research-run: unexpected error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
}
