/**
 * scripts/obsidian-mocs.ts — file vault Maps-of-Content (Live Organism P11). Gated + ADDITIVE.
 *
 * Scans the vault folders, builds linked MOCs (Home lobby + per-area maps), and writes them via the
 * gated Obsidian writer (HARTOS_OBSIDIAN_VAULT_PATH + ALLOW_OBSIDIAN_WRITE). It NEVER deletes or
 * rewrites raw notes — MOCs live in HartOS/Maps/. Also prints a read-only vault hygiene report.
 *
 *   ALLOW_OBSIDIAN_WRITE=true HARTOS_OBSIDIAN_VAULT_PATH=... npm run obsidian:mocs
 */

import { pathToFileURL } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { buildStandardMocs, vaultHygiene, STANDARD_MOCS, type VaultIndex } from "../src/obsidian/moc-builder.js";
import { writeObsidianNote } from "../src/obsidian/obsidian-writer.js";

async function indexFolder(vault: string, folder: string): Promise<{ title: string; relPath: string }[]> {
  const dir = path.join(vault, ...folder.split("/"));
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: { title: string; relPath: string }[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith(".md")) continue;
    let title = e.name.replace(/\.md$/, "");
    try {
      const head = (await readFile(path.join(dir, e.name), "utf8")).slice(0, 400);
      title = head.match(/^title:\s*"?(.+?)"?$/m)?.[1] ?? head.match(/^#\s*(.+)$/m)?.[1] ?? title;
    } catch {
      /* keep filename */
    }
    out.push({ title: title.trim(), relPath: `${folder}/${e.name}` });
  }
  return out;
}

const invokedDirectly = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void (async () => {
    const now = new Date().toISOString();
    const vault = process.env.HARTOS_OBSIDIAN_VAULT_PATH;
    const index: VaultIndex = {};
    if (vault) {
      for (const m of STANDARD_MOCS) {
        if (m.folder) index[m.folder] = await indexFolder(vault, m.folder);
      }
    }
    const mocs = buildStandardMocs(now, index);
    console.log(`\nObsidian MOCs — ${mocs.length} map(s) (additive; nothing deleted/rewritten)`);
    for (const moc of mocs) {
      const res = await writeObsidianNote(moc, process.env);
      console.log(`  ${res.written ? "FILED" : "skip"}: ${moc.title} → ${res.written ? res.relPath : res.reason}`);
    }
    const h = vaultHygiene(index);
    console.log(`\nVault hygiene: ${h.note}`);
    if (h.uncoveredFolders.length) console.log(`  unmapped folders: ${h.uncoveredFolders.join(", ")}`);
    console.log("");
  })();
}
