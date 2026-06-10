/**
 * src/obsidian/obsidian-writer.ts
 *
 * The LOCAL, approval-gated Obsidian vault writer (Node only). It writes a proposed note as a
 * .md file into the configured vault folder — and ONLY when both are true:
 *   - HARTOS_OBSIDIAN_VAULT_PATH is set (the vault folder), and
 *   - ALLOW_OBSIDIAN_WRITE=true (Hart has armed writing — default OFF).
 * Absent either, it returns an honest "not written" (never throws on a gate decision). It runs
 * the same secret guard the other writers use. No network, no provider — a local file write only.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderObsidianNote, notePath } from "./obsidian-note.js";
import type { ObsidianNoteProposal } from "./obsidian-types.js";
import { containsSecret } from "../llm/redaction.js";

export const OBSIDIAN_VAULT_ENV = "HARTOS_OBSIDIAN_VAULT_PATH";
export const OBSIDIAN_WRITE_FLAG = "ALLOW_OBSIDIAN_WRITE";

export interface ObsidianWriteResult {
  written: boolean;
  reason: string;
  /** Absolute path written (only when written). */
  path?: string;
  /** Vault-relative path (always, for reporting). */
  relPath: string;
}

function flagOn(v: string | undefined): boolean {
  return String(v ?? "").trim().toLowerCase() === "true";
}

/**
 * Write the note to the vault if configured + armed. Pure-ish: the gate decisions are derived
 * from env; only the final committed write touches fs.
 */
export async function writeObsidianNote(
  proposal: ObsidianNoteProposal,
  env: Record<string, string | undefined> = process.env,
): Promise<ObsidianWriteResult> {
  const relPath = notePath(proposal);
  const vault = env[OBSIDIAN_VAULT_ENV];
  if (!vault || vault.trim().length === 0) {
    return { written: false, reason: `vault not configured (set ${OBSIDIAN_VAULT_ENV})`, relPath };
  }
  if (!flagOn(env[OBSIDIAN_WRITE_FLAG])) {
    return { written: false, reason: `write disabled (set ${OBSIDIAN_WRITE_FLAG}=true to arm)`, relPath };
  }
  const md = renderObsidianNote(proposal);
  if (containsSecret(md)) {
    return { written: false, reason: "refused: note content looks like it contains a secret", relPath };
  }
  const abs = path.join(vault, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, md, "utf8");
  return { written: true, reason: "note written to vault", path: abs, relPath };
}
