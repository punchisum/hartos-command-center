/**
 * scripts/research-file-to-vault.ts — file an ALREADY-generated research report into the vault.
 *
 * Reconstructs an ObsidianNoteProposal from a saved research-reports/*.md file and writes it via the
 * gated writer (HARTOS_OBSIDIAN_VAULT_PATH + ALLOW_OBSIDIAN_WRITE) — so a report produced earlier can
 * be filed WITHOUT re-spending on a fresh research run. The same secret guard runs on the rendered
 * note. After filing, run rinnegan:sync-pack so the deployed LLM Ask is briefed on it.
 *
 *   ALLOW_OBSIDIAN_WRITE=true HARTOS_OBSIDIAN_VAULT_PATH=... \
 *     npm run research:file-to-vault -- "research-reports/<file>.md"
 */

import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeObsidianNote } from "../src/obsidian/obsidian-writer.js";
import type { ObsidianNoteProposal, NoteConfidence } from "../src/obsidian/obsidian-types.js";

function parseConfidence(body: string): NoteConfidence {
  const m = body.match(/\*\*Confidence:\s*(HIGH|MEDIUM|LOW)\*\*/i);
  const c = (m?.[1] ?? "").toLowerCase();
  return c === "high" ? "high" : c === "medium" ? "medium" : "low";
}

function parseQuestion(body: string): string {
  const m = body.match(/^#\s*Research Dossier\s*[—-]\s*(.+)$/m);
  return (m?.[1] ?? "research").trim();
}

function parseShape(body: string): string {
  const m = body.match(/shape:\s*([a-z]+)/i);
  return (m?.[1] ?? "open").toLowerCase();
}

/** Unique https/http URLs in the report — its citations, for the note's `sources` frontmatter. */
function extractSources(body: string): string[] {
  const urls = [...body.matchAll(/https?:\/\/[^\s)`,\]]+/g)].map((m) => m[0]);
  return [...new Set(urls)];
}

/** Build the note proposal from a saved report file. createdAt derives from the filename date. */
export function proposalFromReport(filePath: string, body: string): ObsidianNoteProposal {
  const question = parseQuestion(body);
  const confidence = parseConfidence(body);
  const shape = parseShape(body);
  const dateMatch = path.basename(filePath).match(/(\d{4}-\d{2}-\d{2})/);
  const createdAt = `${dateMatch?.[1] ?? "2026-01-01"}T12:00:00.000Z`;
  return {
    title: `Research — ${question}`.slice(0, 120),
    folder: "HartOS/Research Dossiers",
    noteType: "research_dossier",
    tags: ["hartos", "research", shape, confidence],
    body,
    sources: extractSources(body),
    confidence,
    reason: "Research synthesis kept in the vault as reusable knowledge for the fleet (LLM Ask / Rinnegan / future research).",
    reviewBy: null,
    relatedAgents: ["Research"],
    relatedProposals: [],
    createdAt,
  };
}

const invokedDirectly = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const arg = process.argv.slice(2).join(" ").trim();
  if (!arg) {
    console.error('Usage: npm run research:file-to-vault -- "research-reports/<file>.md"');
    process.exit(2);
  }
  void (async () => {
    try {
      const abs = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);
      const body = await readFile(abs, "utf8");
      const proposal = proposalFromReport(abs, body);
      const result = await writeObsidianNote(proposal, process.env);
      console.log(`\nFile-to-vault: "${proposal.title}"`);
      console.log(`  sources: ${proposal.sources.length} · confidence: ${proposal.confidence}`);
      console.log(`  vault: ${result.written ? `FILED → ${result.path}` : result.reason}`);
      if (result.written) console.log(`  → run rinnegan:sync-pack to brief the deployed LLM Ask on it.`);
      process.exit(result.written ? 0 : 1);
    } catch (e) {
      console.error(`research-file-to-vault: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  })();
}
