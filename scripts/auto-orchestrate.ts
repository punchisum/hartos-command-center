/**
 * scripts/auto-orchestrate.ts — the REAL wiring of the async multi-agent orchestration runtime.
 *
 * Injects the live agents into runAutoOrchestration: Research brief → Beezulbub scout (consuming
 * the research handoff) → a composed build-plan dossier (consuming both). Each agent keeps its own
 * gates; the runtime's ALLOW_AUTO_ORCHESTRATE gate controls the automatic handoff. PROPOSE-ONLY —
 * it files a build plan for Hart's review; it writes no code and executes no mutation.
 *
 *   ALLOW_AUTO_ORCHESTRATE=true npm run orchestrate:run -- "a markdown editor capability"
 */

import { pathToFileURL } from "node:url";
import { runResearch } from "./research-run.js";
import { runBeezulbubHunt } from "./beezulbub-hunt.js";
import { writeObsidianNote } from "../src/obsidian/obsidian-writer.js";
import { runAutoOrchestration, type OrchestrationSteps, type StepResult } from "../src/hartos/auto-orchestrator.js";
import { redact } from "../src/llm/redaction.js";
import type { ObsidianNoteProposal } from "../src/obsidian/obsidian-types.js";

/** Derive a kebab/word capability target from a free-text request (best-effort, honest fallback). */
function capabilityTarget(request: string): string {
  return request.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "general";
}

export const realOrchestrationSteps: OrchestrationSteps = {
  async research(request, env, now): Promise<StepResult> {
    const r = await runResearch(request, env, now);
    return { step: "research", ok: true, summary: r.lines.slice(-2).join(" | ").slice(0, 200), artifact: { report: r.report, slug: r.slug } };
  },

  async scout(request, _research, env, now): Promise<StepResult> {
    const target = capabilityTarget(request);
    const r = await runBeezulbubHunt(target, env, now);
    return { step: "scout", ok: true, summary: r.lines.slice(-2).join(" | ").slice(0, 200), artifact: { target, report: r.report, lines: r.lines } };
  },

  async plan(request, research, scout, env, now): Promise<StepResult> {
    const researchReport = (research as { report?: string } | null)?.report ?? "_(no research artifact)_";
    const scoutLines = (scout as { lines?: string[] } | null)?.lines ?? [];
    const note: ObsidianNoteProposal = {
      title: `Build plan — ${request}`.slice(0, 80),
      folder: "HartOS/Build Plans",
      noteType: "capability_dossier",
      tags: ["hartos", "build-plan", "auto-orchestrate"],
      body: [
        `# Build plan — ${request}`,
        "",
        `_Auto-composed ${now} by the orchestration runtime (research → scout → plan). PROPOSE-ONLY — review before acting._`,
        "",
        "## Research",
        researchReport.slice(0, 4000),
        "",
        "## Scouted capabilities (Beezulbub)",
        ...(scoutLines.length ? scoutLines.slice(-12).map((l) => `- ${l}`) : ["- _no scout artifact_"]),
        "",
        "## Recommended next steps",
        "- Review the research + scouted candidates above.",
        "- To absorb a candidate: run the gated Beezulbub digest/pack pipeline (still Hart-approved).",
        "- To turn this into working code: the gated code-builder (T5) consumes this plan; nothing here writes code.",
        "",
        "_Composed by the auto-orchestrator. No agent executed a mutation; this is a plan for Hart._",
      ].join("\n"),
      sources: ["research:brief", "beezulbub:hunt"],
      confidence: "medium",
      reason: "Auto-composed multi-agent build plan (research + capability scout) for a capability request.",
      reviewBy: null,
      relatedAgents: ["Research", "Beezulbub", "Orchestrator"],
      relatedProposals: [],
      createdAt: now,
    };
    const write = await writeObsidianNote(note, env);
    return {
      step: "build-plan",
      ok: true,
      summary: write.written ? `filed → ${write.relPath}` : `composed (vault ${write.reason})`,
      artifact: { note, written: write.written },
    };
  },
};

export async function runAutoOrchestrate(request: string, env: Record<string, string | undefined>, now: string) {
  return runAutoOrchestration({ request, env, now, steps: realOrchestrationSteps });
}

const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const request = process.argv.slice(2).join(" ").trim();
  if (!request) {
    console.error('Usage: ALLOW_AUTO_ORCHESTRATE=true npm run orchestrate:run -- "<capability request>"');
    process.exit(2);
  }
  runAutoOrchestrate(request, process.env, new Date().toISOString())
    .then((res) => {
      console.log("\nHartOS — auto-orchestrate (research → scout → build-plan; propose-only)\n");
      for (const l of res.lines) console.log(l);
      console.log("");
    })
    .catch((e) => {
      console.error(`auto-orchestrate failed: ${redact(e instanceof Error ? e.message : String(e))}`);
      process.exit(1);
    });
}
