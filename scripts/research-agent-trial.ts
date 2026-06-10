/**
 * scripts/research-agent-trial.ts — trial the first real domain agent through the full Factory.
 *
 * Runs RESEARCH_AGENT_SPEC end-to-end: compile → validate → officiate → quality gate → simulate,
 * printing the ADMIT/REVISE/REJECT verdict + the behavioral replay. Then it DEMONSTRATES the agent
 * on a sample question with a few clearly-labelled demo sources (the gated gathering edge is stubbed
 * here — no real network/LLM is called), shows the synthesized dossier, and prints the gated Obsidian
 * note proposal that would make it usable across HartOS.
 *
 * Read-only: nothing is provisioned, written, or executed. The persist + note proposals are
 * non-executable drafts requiring Hart's approval.
 *
 *   npm run agent:research-trial
 */

import { pathToFileURL } from "node:url";
import { RESEARCH_AGENT_SPEC } from "../src/agents/research-agent-spec.js";
import { compileSpecToManifest, validateManifest } from "../src/hartos/manifest-compiler.js";
import { officiateFromManifest } from "../src/hartos/factory-officiator.js";
import { planResearch } from "../src/research/research-planner.js";
import { synthesizeResearch, summarizeDossier, type GatheredSource } from "../src/research/research-synthesis.js";
import { researchDossierNote } from "../src/research/research-dossier-note.js";
import type { ReadModelSummary } from "../src/read-models/read-model-types.js";

const NOW = "2026-06-10T12:00:00.000Z";

const HEALTHY: ReadModelSummary = {
  id: "other",
  type: "other",
  status: "ok",
  confidence: "high",
  lines: ["Research dossiers available."],
  metrics: { dossiers: 2 },
  recommendation: "Read-only; review in the cockpit.",
  dataFreshness: "2026-06-10T10:00:00.000Z",
  degradedSources: [],
};

export function runResearchAgentTrial(): string[] {
  const out: string[] = [];
  const push = (s = "") => out.push(s);

  push("\n=== Research Agent — Factory trial (read-only) ===\n");

  // 1) Compile + validate.
  const manifest = compileSpecToManifest(RESEARCH_AGENT_SPEC);
  const violations = validateManifest(manifest);
  push(`1. Compile + validate manifest: ${violations.length === 0 ? "VALID ✓" : `INVALID (${violations.length})`}`);
  for (const v of violations) push(`     - ${v.facet}: ${v.detail}`);

  // 2) Officiate → quality gate → simulate.
  const outcome = officiateFromManifest(manifest, HEALTHY, { now: NOW });
  push(`2. Officiation: ${outcome.officiated ? "officiated ✓" : "NOT officiated ✗"}`);
  if (outcome.violations.length) for (const v of outcome.violations) push(`     - ${v}`);

  push(`3. Quality gate: ${outcome.quality.rating} (score ${outcome.quality.score}) — ${outcome.quality.summary}`);
  for (const f of outcome.quality.facets) push(`     [${f.status.toUpperCase().padEnd(4)}] ${f.facet}: ${f.detail}`);

  push(`4. Behavioral simulation: ${outcome.simulation.verdict} — ${outcome.simulation.summary}`);
  for (const s of outcome.simulation.scenarios) {
    push(`     ${s.ok ? "✓" : "✗"} ${s.redTeam ? "[red-team]" : "[happy]   "} ${s.id}: ${s.ok ? "as expected" : s.notes.join("; ")}`);
  }

  const admitted = outcome.officiated && outcome.quality.admit && outcome.simulation.verdict === "PASS" && violations.length === 0;
  push(`\n=> VERDICT: ${admitted ? "ADMITTED — the Factory would register this agent (gated persist proposal)." : "NOT admitted — fix the failing gate(s) above."}`);

  // 5) Demonstrate the agent's behavior (gathering stubbed — clearly labelled demo sources).
  push("\n--- Demonstration: a sample research run (demo sources; no real network/LLM) ---");
  const question = "compare Postgres and SQLite for an edge app";
  const plan = planResearch(question);
  const demoSources: GatheredSource[] = [
    { ref: "pg-docs", title: "PostgreSQL Documentation", content: "Postgres is a client-server RDBMS built for concurrent writes and rich querying.", answers: [0, 2], asOf: NOW },
    { ref: "sqlite-edge", title: "SQLite at the Edge", content: "SQLite is an embedded, file-based database ideal for low-latency local reads at the edge.", answers: [0, 2], asOf: NOW },
    { ref: "tradeoffs", title: "Edge DB Trade-offs", content: "The trade-off is concurrency + durability (Postgres) versus zero-ops local speed (SQLite).", answers: [3], asOf: NOW },
  ];
  const dossier = synthesizeResearch(plan, demoSources, { now: NOW });
  push(`   ${summarizeDossier(dossier)}`);
  push(`   exec summary:`);
  for (const l of dossier.executiveSummary) push(`     ${l}`);
  push(`   reusable knowledge (usable across HartOS):`);
  for (const k of dossier.knowledgeItems) push(`     • ${k.claim}  [${k.confidence}; ${k.sources.join(", ")}]`);
  push(`   open questions: ${dossier.unknowns.length}`);

  // 6) The gated knowledge-loop output.
  const note = researchDossierNote(dossier, NOW);
  push(`\n--- Knowledge-loop output: gated Obsidian note proposal (non-executable) ---`);
  push(`   note: "${note.title}" → ${note.folder} (type ${note.noteType}, ${note.confidence} confidence)`);
  push(`   becomes usable across HartOS: vault → Rinnegan briefing → LLM Ask + Prophet/awareness.`);
  push(`   write is gated on Hart approval + HARTOS_OBSIDIAN_VAULT_PATH + ALLOW_OBSIDIAN_WRITE.\n`);

  return out;
}

const invokedDirectly = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  for (const line of runResearchAgentTrial()) console.log(line);
}
