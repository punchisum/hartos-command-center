/**
 * scripts/beezulbub-hunt.ts — fire Beezulbub LIVE + close the loop.
 *
 * Live-scouts GitHub for a capability target, renders a capability-scout dossier, files it into the
 * vault (gated), and writes a local report. Read-only + propose-only: it discovers + reports; it
 * never clones, copies, or absorbs code (that's a separate gated digest/approval step).
 *
 * Gating (fail-closed): live search needs BEEZULBUB_ALLOW_NETWORK=true (else it falls back to
 * fixtures, honestly labelled). The vault write needs HARTOS_OBSIDIAN_VAULT_PATH + ALLOW_OBSIDIAN_WRITE.
 *
 *   BEEZULBUB_ALLOW_NETWORK=true npm run beezulbub:hunt -- markdown_editor
 */

import { pathToFileURL } from "node:url";
import { scoutCandidates } from "../src/beezulbub/scout.js";
import { capabilityScoutNote } from "../src/beezulbub/capability-dossier-note.js";
import { buildCapabilityAssessor, assessTopCandidates } from "../src/beezulbub/llm-assessment.js";
import { writeObsidianNote } from "../src/obsidian/obsidian-writer.js";
import { renderObsidianNote } from "../src/obsidian/obsidian-note.js";
import { CAPABILITY_TARGETS } from "../src/beezulbub/registry.js";
import { resolveLlmConfig } from "../src/llm/llm-gateway.js";

export async function runBeezulbubHunt(
  target: string,
  env: Record<string, string | undefined>,
  now: string,
): Promise<{ lines: string[]; report: string; target: string }> {
  const out: string[] = [];
  const push = (s = "") => out.push(s);

  const allowNetwork = String(env["BEEZULBUB_ALLOW_NETWORK"] ?? "").trim().toLowerCase() === "true";
  push(`\n=== Beezulbub hunt (read-only, propose-only) ===`);
  push(`Target: ${target}`);
  push(`Gating: BEEZULBUB_ALLOW_NETWORK=${allowNetwork ? "true (live)" : "off (fixtures)"} · GITHUB_TOKEN=${env["GITHUB_TOKEN"] ? "present" : "absent"}`);
  if (!CAPABILITY_TARGETS.includes(target as (typeof CAPABILITY_TARGETS)[number])) {
    push(`Note: "${target}" is not a registered capability target — live search will still run on the raw term.`);
  }

  const result = await scoutCandidates({ target, live: true, githubToken: env["GITHUB_TOKEN"] });
  push(`\nScout: mode=${result.mode} · ${result.candidates.length} candidate(s)`);
  for (const [i, c] of result.candidates.entries()) {
    push(`  ${i + 1}. ${c.name} — ${c.estimatedValue}/10 · ${c.licenseGuess ?? "license?"} · stale:${c.staleRisk}`);
    if (c.sourceUrl) push(`     ${c.sourceUrl}`);
  }
  push(`\nRecommendation: ${result.recommendation}`);

  // Option 2: LLM-deepen the top candidates when the gateway is armed (else heuristics only).
  const cfg = resolveLlmConfig(env);
  const deepen = cfg.provider === "openai" && cfg.networkEnabled && cfg.apiKeyPresent;
  const assessments = deepen ? await assessTopCandidates(result.candidates, buildCapabilityAssessor(env), 3) : [];
  push(`\nLLM due-diligence: ${deepen ? `${assessments.length} candidate(s) assessed (model=${cfg.model})` : "off (set HARTOS_LLM_PROVIDER=openai to deepen)"}`);

  const note = capabilityScoutNote(result, now, { assessments });
  push(`\n--- Gated knowledge-loop output ---`);
  push(`  note: "${note.title}" → ${note.folder} (type ${note.noteType}, ${note.confidence} confidence)`);
  const write = await writeObsidianNote(note, env);
  push(`  vault: ${write.written ? `FILED → ${write.relPath}` : write.reason}`);
  if (write.written) push(`  → run rinnegan:sync-pack to brief the deployed LLM Ask on it.`);
  if (result.mode !== "live") {
    push(`\n  (Honest read: not a live scout — set BEEZULBUB_ALLOW_NETWORK=true for real GitHub results.)`);
  }

  return { lines: out, report: renderObsidianNote(note), target };
}

const invokedDirectly = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const target = process.argv.slice(2).join(" ").trim();
  if (!target) {
    console.error(`Usage: npm run beezulbub:hunt -- <capability_target>\nKnown targets: ${CAPABILITY_TARGETS.join(", ")}`);
    process.exit(2);
  }
  void (async () => {
    try {
      const now = new Date().toISOString();
      const { lines, report } = await runBeezulbubHunt(target, process.env, now);
      for (const l of lines) console.log(l);
      const { mkdir, writeFile } = await import("node:fs/promises");
      const path = await import("node:path");
      const dir = path.join(process.cwd(), "beezulbub-reports");
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${target}-${now.slice(0, 10)}.md`);
      await writeFile(file, report, "utf8");
      console.log(`\nReport written: ${file}`);
    } catch (e) {
      console.error(`beezulbub-hunt: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  })();
}
