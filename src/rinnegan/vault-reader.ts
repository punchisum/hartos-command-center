/**
 * src/rinnegan/vault-reader.ts — Node-only: read the Obsidian vault into RinneganNote[].
 *
 * Walks HARTOS_OBSIDIAN_VAULT_PATH, reads each .md, and extracts title/tags/review_by from the
 * frontmatter (falling back to filename/folder), with mtime-based ageDays. Used by the Rinnegan
 * compile CLI + the context-pack sync. NOT imported by the Worker (the Worker reads the mirrored
 * pack from Supabase).
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { RinneganNote } from "./rinnegan-types.js";

/** Strip frontmatter + the provenance callout, collapse whitespace, truncate. */
export function noteExcerpt(body: string, max = 4000): string {
  let b = body.replace(/^---[\s\S]*?---\s*/m, "").replace(/^>\s*\[!info\][^\n]*\n+/m, "").trim();
  b = b.replace(/[ \t]+/g, " ");
  return b.length > max ? b.slice(0, max) : b;
}

export async function readVaultNotes(vault: string | undefined, now: string): Promise<RinneganNote[]> {
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
