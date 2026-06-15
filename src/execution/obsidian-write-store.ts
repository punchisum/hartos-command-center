/**
 * src/execution/obsidian-write-store.ts — the LIVE (fs-backed) ObsidianWriteStore for the spine.
 *
 * `exists` = a stat of the target path under the vault (read-before-write). `write` delegates to the
 * blessed `writeObsidianNote`, which renders the note, runs the secret-scan, and enforces the same
 * ALLOW_OBSIDIAN_WRITE gate — so this store adds no authority and preserves the secret guard.
 * Returns null when the vault is not configured (the executor then skips the adapter honestly).
 * NODE/EDGE ONLY — touches the local filesystem; never imported by the read-only Worker.
 */

import { stat } from "node:fs/promises";
import path from "node:path";
import { notePath } from "../obsidian/obsidian-note.js";
import { writeObsidianNote, OBSIDIAN_VAULT_ENV } from "../obsidian/obsidian-writer.js";
import type { ObsidianWriteStore } from "./adapters/obsidian-write.js";

export function createObsidianWriteStore(env: Record<string, string | undefined>): ObsidianWriteStore | null {
  const vault = env[OBSIDIAN_VAULT_ENV];
  if (!vault || vault.trim().length === 0) return null;
  return {
    async exists(note) {
      try {
        await stat(path.join(vault, notePath(note)));
        return true;
      } catch {
        return false;
      }
    },
    async write(note) {
      return writeObsidianNote(note, env);
    },
  };
}
