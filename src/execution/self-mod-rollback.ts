/**
 * src/execution/self-mod-rollback.ts — Phase 6: restore the working tree to the pre-self-mod baseline.
 *
 * When a self-mod run fails post-verify (out of scope / secret / tests), the executor calls this to
 * UNDO it. Because pre-verify guaranteed a CLEAN baseline, every changed file is the run's own: a file
 * that existed at the baseline is restored to its baseline content; a file the run newly created is
 * removed. The W3 hand never commits, so the baseline sha is still HEAD. Injectable git so tests are
 * hermetic. A failed rollback is serious (the tree is in an unknown state) — errors are surfaced,
 * never swallowed; remove is still attempted even if restore failed (best-effort cleanup).
 */
import { spawnSync } from "node:child_process";
import type { ExecBaseline } from "./claude-exec-baseline.js";

export interface SelfModRollbackGit {
  /** Subset of `paths` that existed (were tracked) at the baseline sha. */
  existedAtBaseline(cwd: string, baselineSha: string, paths: string[]): string[];
  /** Restore tracked files to the baseline sha (discard the run's modifications). */
  restoreToBaseline(cwd: string, baselineSha: string, paths: string[]): void;
  /** Delete files the run newly created (untracked at baseline). */
  removeFiles(cwd: string, paths: string[]): void;
}

export interface RollbackResult {
  ok: boolean;
  /** Paths we ATTEMPTED to restore (intent, not a per-file success guarantee — see ok/errors). */
  attemptedRestore: string[];
  /** Paths we ATTEMPTED to remove. */
  attemptedRemove: string[];
  errors: string[];
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function runGit(args: string[], cwd: string): { ok: boolean; stderr: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
  return { ok: (r.status ?? 1) === 0, stderr: (r.stderr ?? "").trim().slice(0, 200) };
}

export const realSelfModRollbackGit: SelfModRollbackGit = {
  existedAtBaseline(cwd, baselineSha, paths) {
    return paths.filter((p) => runGit(["cat-file", "-e", `${baselineSha}:${p}`], cwd).ok);
  },
  restoreToBaseline(cwd, baselineSha, paths) {
    if (paths.length === 0) return;
    // `git restore --staged --worktree` restores BOTH the index and the working tree to the baseline,
    // leaving a genuinely CLEAN tree (plain `git checkout <sha> -- path` would leave the file STAGED).
    const r = runGit(["restore", "--source", baselineSha, "--staged", "--worktree", "--", ...paths], cwd);
    if (!r.ok) throw new Error(`git restore failed: ${r.stderr}`);
  },
  removeFiles(cwd, paths) {
    if (paths.length === 0) return;
    const r = runGit(["clean", "-f", "--", ...paths], cwd);
    if (!r.ok) throw new Error(`git clean failed: ${r.stderr}`);
  },
};

/** Undo a self-mod: restore baseline-existing files, remove newly-created ones. Clean baseline assumed. */
export function rollbackSelfMod(
  cwd: string,
  baseline: ExecBaseline,
  changedFiles: string[],
  git: SelfModRollbackGit = realSelfModRollbackGit,
): RollbackResult {
  const errors: string[] = [];

  let existed: string[];
  try {
    existed = git.existedAtBaseline(cwd, baseline.headSha, changedFiles);
  } catch (e) {
    return { ok: false, attemptedRestore: [], attemptedRemove: [], errors: [`existedAtBaseline failed: ${msg(e)}`] };
  }

  const existedSet = new Set(existed);
  const toRestore = changedFiles.filter((f) => existedSet.has(f));
  const toRemove = changedFiles.filter((f) => !existedSet.has(f));

  try {
    git.restoreToBaseline(cwd, baseline.headSha, toRestore);
  } catch (e) {
    errors.push(`restore failed: ${msg(e)}`);
  }

  try {
    git.removeFiles(cwd, toRemove);
  } catch (e) {
    errors.push(`remove failed: ${msg(e)}`);
  }

  return { ok: errors.length === 0, attemptedRestore: toRestore, attemptedRemove: toRemove, errors };
}
