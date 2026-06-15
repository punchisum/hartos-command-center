/**
 * src/execution/run-obsidian-write.ts — the gated obsidian-write executor (mirrors run-clickup-comment).
 *
 * The Node host enforces the Phase 2.5 fail-closed gate (via `runExecutionAdapter`) and, only when
 * it passes, drives the write through the injected store. `dryRun:true` is the read-only preview
 * (confirm whether the note exists; no write); the real path writes exactly one note (or no-ops if
 * it already exists). The vault path is the local "capability" — the gate's hasCapabilityToken is
 * satisfied when HARTOS_OBSIDIAN_VAULT_PATH is configured. Flag (ALLOW_OBSIDIAN_WRITE) OFF ⇒ refused.
 *
 * NODE/EDGE ONLY — the live store touches the local filesystem; never imported by the Worker.
 */

import { runExecutionAdapter, type ExecutionContext, type AdapterRunResult } from "./execution-adapter.js";
import { obsidianWriteAdapter, type ObsidianWriteStore } from "./adapters/obsidian-write.js";
import { notePath } from "../obsidian/obsidian-note.js";
import { OBSIDIAN_VAULT_ENV } from "../obsidian/obsidian-writer.js";
import type { ObsidianNoteProposal } from "../obsidian/obsidian-types.js";

export interface ObsidianWriteProposal {
  id: string;
  status: ExecutionContext["status"];
  expiresAt: string | null;
}

export interface ObsidianWriteTarget {
  /** The note to file into the vault (the gated writer renders + secret-scans it). */
  note: ObsidianNoteProposal;
}

/**
 * Run the gated obsidian-write action against an authorized proposal. `runExecutionAdapter` enforces
 * the fail-closed gate + the per-action allowlist flag BEFORE any write — pass `dryRun:true` to only
 * preview. The store is injected (fs-backed live store in production, a fake in tests); `now` is
 * injected so the path is hermetic/testable.
 */
export async function runObsidianWrite(
  proposal: ObsidianWriteProposal,
  target: ObsidianWriteTarget,
  env: Record<string, string | undefined>,
  opts: { now?: string; dryRun?: boolean; store: ObsidianWriteStore; hasCapabilityToken?: boolean },
): Promise<AdapterRunResult> {
  const now = opts.now ?? new Date().toISOString();
  const relPath = notePath(target.note);
  const adapterDeps = { store: opts.store, note: target.note, relPath };
  const ctx: ExecutionContext = {
    proposalId: proposal.id,
    status: proposal.status,
    expiresAt: proposal.expiresAt,
    now,
    // Write authorization for a LOCAL write = the vault being configured (the local "capability").
    // An explicit override wins when the caller knows.
    hasCapabilityToken: opts.hasCapabilityToken ?? Boolean(env[OBSIDIAN_VAULT_ENV]),
    env,
  };
  const writeAudit = async (event: string, detail: string): Promise<void> => {
    // Framework-level trace; the durable audit row is written by the proposal spine.
    console.log(`[exec-audit] ${event}: ${detail}`);
  };

  if (opts.dryRun) {
    const outcome = await obsidianWriteAdapter.dryRun(adapterDeps);
    await writeAudit("execution_dry_run", outcome.summary);
    return { adapterId: obsidianWriteAdapter.id, precondition: { allowed: true, denials: [] }, executed: false, outcome };
  }

  return runExecutionAdapter(obsidianWriteAdapter, ctx, { adapterDeps, writeAudit });
}
