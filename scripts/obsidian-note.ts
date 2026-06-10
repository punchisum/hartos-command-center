/**
 * scripts/obsidian-note.ts — generate the Wolverine Audit Summary note for the Obsidian vault.
 *
 * DEFAULT = preview (renders the note to stdout; writes nothing). With `--write` it writes to the
 * vault, but ONLY if HARTOS_OBSIDIAN_VAULT_PATH is set AND ALLOW_OBSIDIAN_WRITE=true (default OFF).
 * Read-only by default; the write is a local file only (no network, no provider). Propose-first.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/obsidian-note.js            # preview
 *   node --env-file-if-exists=.env.local dist/scripts/obsidian-note.js --write    # write (if armed)
 */

import { pathToFileURL } from "node:url";
import { wolverineAudit } from "../src/wolverine/wolverine-audit.js";
import { wolverineAuditNote } from "../src/obsidian/obsidian-from-wolverine.js";
import { renderObsidianNote, notePath } from "../src/obsidian/obsidian-note.js";
import { writeObsidianNote, OBSIDIAN_VAULT_ENV, OBSIDIAN_WRITE_FLAG } from "../src/obsidian/obsidian-writer.js";
import { resolveHostedCockpitState } from "../src/runtime/cloudflare-live-read-models.js";

export interface ObsidianNoteCliResult {
  exitCode: number;
  lines: string[];
}

export async function runObsidianWolverineNote(
  env: Record<string, string | undefined>,
  now: string,
  write: boolean,
): Promise<ObsidianNoteCliResult> {
  const lines: string[] = [];
  const state = await resolveHostedCockpitState(env, { now }).catch(() => null);
  const staleSources = state?.sourceDiagnostics?.staleSources ?? [];
  const report = wolverineAudit({ now, env, staleSources }); // system health (no git-hygiene noise)
  const note = wolverineAuditNote(report, now);

  if (!write) {
    lines.push(`Obsidian note PREVIEW (nothing written) → vault path: ${notePath(note)}`);
    lines.push(`To write: set ${OBSIDIAN_VAULT_ENV}=<your vault folder> and ${OBSIDIAN_WRITE_FLAG}=true, then re-run with --write.`);
    lines.push("────────────────────────────────────────");
    lines.push(renderObsidianNote(note));
    return { exitCode: 0, lines };
  }

  const res = await writeObsidianNote(note, env);
  lines.push(res.written ? `WROTE note → ${res.path}` : `Not written: ${res.reason}  (would be: ${res.relPath})`);
  return { exitCode: 0, lines };
}

const invokedDirectly =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const write = process.argv.slice(2).includes("--write");
  runObsidianWolverineNote(process.env, new Date().toISOString(), write)
    .then((res) => {
      for (const l of res.lines) console.log(l);
      process.exit(res.exitCode);
    })
    .catch((e) => {
      console.error(`obsidian-note: unexpected error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
}
