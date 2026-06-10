/**
 * scripts/rinnegan-compile.ts — Rinnegan context compiler CLI (the host edge).
 *
 * Gathers the raw materials for an intent — Obsidian vault notes (meaning) + live read-model
 * facts (via the deterministic grounding) + executive-memory patterns — runs the pure compiler,
 * and prints the ranked, freshness-tagged briefing the LLM Ask would reason over. Read-only.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/rinnegan-compile.js "anything urgent in ops"
 */

import { pathToFileURL } from "node:url";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { compileContext, toBriefing } from "../src/rinnegan/rinnegan-compiler.js";
import { resolveHostedCockpitState } from "../src/runtime/cloudflare-live-read-models.js";
import { routeHosted } from "../src/runtime/cloudflare-cockpit-views.js";
import { executiveMemory } from "../src/awareness/executive-memory.js";
import type { RinneganFact, RinneganNote, RinneganPattern } from "../src/rinnegan/rinnegan-types.js";

async function gatherNotes(vault: string | undefined, now: string): Promise<RinneganNote[]> {
  if (!vault || vault.trim().length === 0) return [];
  const nowMs = Date.parse(now);
  const out: RinneganNote[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!e.name.toLowerCase().endsWith(".md")) continue;
      let body = "";
      try {
        body = await readFile(full, "utf8");
      } catch {
        continue;
      }
      const rel = path.relative(vault as string, full).replace(/\\/g, "/");
      const head = body.slice(0, 1000);
      const titleM = head.match(/^title:\s*"?(.+?)"?\s*$/m);
      const title = titleM ? titleM[1].trim() : e.name.replace(/\.md$/i, "");
      const tagsM = head.match(/^tags:\s*\[(.*?)\]/m);
      const tags = tagsM
        ? tagsM[1].split(",").map((t) => t.replace(/["']/g, "").trim()).filter(Boolean)
        : [rel.split("/")[0] ?? ""];
      const revM = head.match(/^review_by:\s*(.+)$/m);
      const reviewBy = revM ? revM[1].trim() : null;
      let ageDays: number | null = null;
      try {
        const s = await stat(full);
        ageDays = Math.max(0, Math.round((nowMs - s.mtimeMs) / 86_400_000));
      } catch {
        /* ignore */
      }
      out.push({ relPath: rel, title, tags, body, reviewBy, ageDays });
    }
  }
  await walk(vault);
  return out;
}

export async function runRinneganCompile(
  env: Record<string, string | undefined>,
  now: string,
  intent: string,
): Promise<{ exitCode: number; lines: string[] }> {
  const lines: string[] = [];
  const state = await resolveHostedCockpitState(env, { now }).catch(() => null);

  const grounding = routeHosted(state ?? undefined, intent, now);
  const facts: RinneganFact[] = (grounding.highlights ?? []).map((h) => ({
    label: grounding.intent ?? "fact",
    value: h,
    source: "read-model",
    freshness: "live",
  }));

  const mem = executiveMemory(state?.memorySnapshots ?? [], { now });
  const patterns: RinneganPattern[] =
    mem.status === "ok" ? mem.recurringPatterns.map((p) => ({ subject: p.subject, evidence: p.evidence })) : [];

  const notes = await gatherNotes(env.HARTOS_OBSIDIAN_VAULT_PATH, now);

  const ctx = compileContext({ intent, now, notes, facts, patterns });
  lines.push(`Rinnegan context compiler — intent: "${intent}"`);
  lines.push(`  scanned: ${notes.length} vault notes · ${facts.length} live facts · ${patterns.length} memory patterns`);
  lines.push(`  ${ctx.note}`);
  lines.push("");
  lines.push(toBriefing(ctx) || "  (no relevant context)");
  return { exitCode: 0, lines };
}

const invokedDirectly =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const intent = process.argv.slice(2).join(" ").trim() || "what should I focus on today";
  runRinneganCompile(process.env, new Date().toISOString(), intent)
    .then((res) => {
      for (const l of res.lines) console.log(l);
      process.exit(res.exitCode);
    })
    .catch((e) => {
      console.error(`rinnegan-compile: unexpected error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
}
