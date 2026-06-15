/**
 * src/organs/adapters/research.ts — the Research organ adapter.
 *
 * Entrypoint = runResearch(question, env, now) (scripts/research-run.ts) — the LIVE (gated) research
 * job: plan → gather (gated edge, network+LLM) → synthesize → propose a dossier note. A real run is
 * EXPENSIVE (live LLM/web fetch) and, per current ops, OpenAI is out of paid credit (Gemini fallback),
 * so a default-scheduled gather likely fails. Therefore this organ does NOT trigger a heavy live run by
 * default: it performs a cheap readiness/last-dossier check instead, reporting the most recent EXISTING
 * research dossier as evidence the loop is alive and has produced real artifacts.
 *
 * Doctrine: status DERIVED from evidence; NEVER fake ok:true. ok=true means we found a real, readable
 * dossier on disk (outputRef = its path, summary = its title). If we cannot cheaply find one, we return
 * an HONEST PARTIAL ok:false — never a fabricated success. Any throw is captured as an honest ok:false.
 * Thin: it reimplements nothing of the research pipeline; it only reads back existing output.
 */
import type { OrganAdapter } from "../organ-supervisor.js";
import type { OrganRunResult } from "../organ-contract.js";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** Trim the honest summary to the contract's <300-char budget. */
function cap(s: string): string {
  return s.length > 299 ? s.slice(0, 299) : s;
}

/** The local artifact dir scripts/research-run.ts writes finished dossiers to. */
const RESEARCH_REPORTS_DIR = "research-reports";

/** First markdown heading in a dossier ("# Title…") → the human title; fall back to the filename. */
function extractTitle(markdown: string, fallback: string): string {
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m && m[1]) return m[1];
  }
  return fallback;
}

export const researchOrgan: OrganAdapter = {
  organId: "research",
  armingFlag: "HARTOS_RESEARCH_GATHER",
  async run(env: NodeJS.ProcessEnv, _now: string): Promise<OrganRunResult> {
    // Cheap readiness/last-dossier check — NO heavy live LLM/web gather by default. A real gather is
    // expensive and (OpenAI out of credit) likely fails, so we report the freshest existing dossier.
    const partial: OrganRunResult = {
      ok: false,
      outputRef: null,
      summary: "research idle; OpenAI out of credit (Gemini fallback) — no recent dossier",
    };
    try {
      const dir = join(env.HARTOS_RESEARCH_REPORTS_DIR ?? process.cwd(), RESEARCH_REPORTS_DIR);
      let entries: string[];
      try {
        entries = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(".md"));
      } catch {
        // No reports dir / unreadable ⇒ honest PARTIAL, not a throw and not a fabricated success.
        return partial;
      }
      if (entries.length === 0) return partial;

      // Newest dossier by mtime = the most recent real research output.
      let newest: { path: string; mtimeMs: number } | null = null;
      for (const name of entries) {
        const path = join(dir, name);
        try {
          const s = await stat(path);
          if (!s.isFile()) continue;
          if (newest === null || s.mtimeMs > newest.mtimeMs) newest = { path, mtimeMs: s.mtimeMs };
        } catch {
          // Skip a vanished/locked entry; absence of one file is not a failure of the check.
        }
      }
      if (newest === null) return partial;

      const filename = newest.path.split(/[\\/]/).pop() ?? newest.path;
      let title = filename;
      try {
        title = extractTitle(await readFile(newest.path, "utf8"), filename);
      } catch {
        // Title best-effort; the dossier still exists and is the real outputRef.
      }
      return {
        ok: true,
        outputRef: newest.path,
        summary: cap(`Research — latest dossier: ${title}`),
        detail: {
          dossierPath: newest.path,
          dossierFile: filename,
          dossierTitle: title,
          dossierMtime: new Date(newest.mtimeMs).toISOString(),
          dossierCount: entries.length,
          mode: "last-dossier readback (no live gather)",
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, outputRef: null, summary: cap(`research readiness check failed: ${msg}`) };
    }
  },
};
