/**
 * scripts/rinnegan-sync-pack.ts — mirror the Obsidian vault into the Supabase context pack.
 *
 * Node host: reads the vault notes and upserts their metadata + body excerpt into
 * public.cockpit_context_pack so the deployed Worker can read them (it can't read the local vault).
 * Prunes pack rows for notes that no longer exist. Secret-guarded. Run on a cadence (like the
 * memory heartbeat) so the deployed Ask's compiled briefings stay fresh.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/rinnegan-sync-pack.js
 */

import { pathToFileURL } from "node:url";
import { readVaultNotes, noteExcerpt } from "../src/rinnegan/vault-reader.js";
import {
  createContextPackDb,
  CONTEXT_PACK_UPSERT_SQL,
  CONTEXT_PACK_PRUNE_SQL,
  CONTEXT_PACK_DB_URL_ENV,
} from "../src/rinnegan/context-pack-db.js";
import { containsSecret } from "../src/llm/redaction.js";

export async function runSyncPack(
  env: Record<string, string | undefined>,
  now: string,
): Promise<{ exitCode: number; lines: string[] }> {
  const lines: string[] = ["Rinnegan — sync context pack (vault → Supabase)"];
  const vault = env.HARTOS_OBSIDIAN_VAULT_PATH;
  if (!vault || vault.trim().length === 0) {
    lines.push("  vault not configured (set HARTOS_OBSIDIAN_VAULT_PATH) — nothing to sync.");
    return { exitCode: 0, lines };
  }
  const handle = createContextPackDb(env);
  if (!handle) {
    lines.push(`  context-pack DB not configured (set ${CONTEXT_PACK_DB_URL_ENV}) — nothing to sync.`);
    return { exitCode: 0, lines };
  }

  const notes = await readVaultNotes(vault, now);
  lines.push(`  read ${notes.length} vault note(s)`);
  try {
    const paths: string[] = [];
    let skipped = 0;
    for (const n of notes) {
      const excerpt = noteExcerpt(n.body, 4000);
      if (containsSecret(excerpt)) {
        skipped += 1;
        continue; // never mirror secret-looking content into the pack
      }
      const folder = n.relPath.split("/").slice(0, -1).join("/");
      await handle.query(CONTEXT_PACK_UPSERT_SQL, [n.relPath, n.title, n.tags, folder, excerpt, n.reviewBy ?? null, n.ageDays ?? null]);
      paths.push(n.relPath);
    }
    if (paths.length) await handle.query(CONTEXT_PACK_PRUNE_SQL, [paths]);
    lines.push(`  synced ${paths.length} note(s)${skipped ? `, skipped ${skipped} (secret-looking)` : ""} → cockpit_context_pack.`);
    lines.push("  The deployed Ask will now compile briefings over these notes.");
    return { exitCode: 0, lines };
  } finally {
    await handle.close();
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runSyncPack(process.env, new Date().toISOString())
    .then((res) => {
      for (const l of res.lines) console.log(l);
      process.exit(res.exitCode);
    })
    .catch((e) => {
      console.error(`rinnegan-sync-pack: unexpected error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
}
