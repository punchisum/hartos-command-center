/**
 * src/execution/adapters/obsidian-write.ts — a LOCAL external (filesystem) mutation.
 *
 * Effect — writes ONE Markdown note into the configured Obsidian vault (the meaning layer). It is
 * the safest external write: local-only, non-public, purely additive, fully reversible (delete the
 * file). It is the first non-ClickUp external adapter, and it carries the same T3 payload:
 *   • read-before-write — the target path is checked first; if the note already exists this is an
 *     idempotent NO-OP (a re-run writes nothing, never clobbers an existing note),
 *   • before/after — fileExists before vs. after,
 *   • dry-run — a read-only path that reports what WOULD be written, writing nothing,
 *   • correction note — how the write is undone (delete the file).
 *
 * All I/O goes through an injected `ObsidianWriteStore`, so the action is unit-testable with a fake
 * (no fs). The LIVE store wraps `writeObsidianNote` (which renders the note, runs the secret-scan,
 * and enforces the same `ALLOW_OBSIDIAN_WRITE` gate) — so the secret guard is preserved. Gated like
 * every adapter: its allowlist flag (`ALLOW_OBSIDIAN_WRITE`, default OFF) under the global
 * kill-switch — nothing writes until the flag is deliberately, narrowly enabled. NODE/EDGE ONLY.
 */

import type { ExecutionAdapter, ExecutionOutcome } from "../execution-adapter.js";
import type { ObsidianNoteProposal } from "../../obsidian/obsidian-types.js";
import { OBSIDIAN_WRITE_FLAG } from "../../obsidian/obsidian-writer.js";

/** Result shape returned by the injected gated writer (mirrors ObsidianWriteResult). */
export interface ObsidianWriteResultLike {
  written: boolean;
  reason: string;
  relPath: string;
  path?: string;
}

/** Injected I/O seam — fs in production, a fake in tests (no fs/network in the adapter). */
export interface ObsidianWriteStore {
  /** Read-before-write: does the target note file already exist in the vault? */
  exists(note: ObsidianNoteProposal): Promise<boolean>;
  /** The gated local write (production wraps writeObsidianNote). Returns whether it wrote + the path. */
  write(note: ObsidianNoteProposal): Promise<ObsidianWriteResultLike>;
}

export interface ObsidianWriteDeps {
  store: ObsidianWriteStore;
  note: ObsidianNoteProposal;
  /** notePath(note), computed by the runner for honest reporting. */
  relPath: string;
}

/** How a written note is undone — surfaced as the T3 correction note. */
function correctionNote(relPath: string): string {
  return `Correction: delete the vault file "${relPath}" to undo.`;
}

/** Per-action allowlist flag — reuses the existing armed Obsidian write gate. */
export const obsidianWriteAdapter: ExecutionAdapter<ObsidianWriteDeps> = {
  id: "obsidian-write",
  allowlistFlag: OBSIDIAN_WRITE_FLAG,

  async dryRun(deps): Promise<ExecutionOutcome> {
    // Read-only: does the target already exist? Report what WOULD happen; write nothing.
    const exists = await deps.store.exists(deps.note);
    if (exists) {
      return {
        ran: false,
        reversible: true,
        before: { fileExists: true, relPath: deps.relPath },
        after: { fileExists: true, relPath: deps.relPath },
        summary: `Dry-run: note already exists at "${deps.relPath}" — would write nothing (idempotent).`,
      };
    }
    return {
      ran: false,
      reversible: true,
      before: { fileExists: false, relPath: deps.relPath },
      after: { fileExists: true, relPath: deps.relPath },
      summary: `Dry-run: would write note to the vault at "${deps.relPath}". No write performed.`,
    };
  },

  async execute(deps): Promise<ExecutionOutcome> {
    // 1) Read-before-write. If the note is already there, this is an idempotent no-op (never clobber).
    const before = await deps.store.exists(deps.note);
    if (before) {
      return {
        ran: false,
        reversible: true,
        before: { fileExists: true, relPath: deps.relPath },
        after: { fileExists: true, relPath: deps.relPath },
        summary: `No-op: note already exists at "${deps.relPath}"; an idempotent re-run writes nothing.`,
      };
    }

    // 2) The single external write — additive, reversible. The store (writeObsidianNote) runs the
    //    secret-scan + the gate again; an honest written:false (e.g. secret detected) is a refusal.
    const res = await deps.store.write(deps.note);
    if (!res.written) {
      return {
        ran: false,
        reversible: true,
        before: { fileExists: false, relPath: deps.relPath },
        after: { fileExists: false, relPath: deps.relPath },
        summary: `REFUSED: ${res.reason}`,
      };
    }
    return {
      ran: true,
      reversible: true,
      before: { fileExists: false, relPath: deps.relPath },
      after: { fileExists: true, relPath: res.relPath, path: res.path },
      summary: `Wrote note to the vault at "${res.relPath}". ${correctionNote(res.relPath)}`,
    };
  },
};
