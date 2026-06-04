/**
 * src/execution/local-git.ts
 *
 * Phase 18A — LOCAL-ONLY git operations for the scaffold/PR-prep executor.
 *
 * This interface DELIBERATELY has NO push and NO remote operations. 18A produces a local branch +
 * commit + PR-prep bundle only; the actual push / repo-create / PR-open is gated to 18B. Making
 * "push" architecturally absent here means the 18A code path cannot mutate GitHub even by mistake.
 *
 * All commands use spawnSync (no shell) to avoid injection. No git command prints a token/secret.
 * Injectable so tests run hermetically without touching a real git binary.
 */

import { spawnSync } from "node:child_process";

/** Local git operations. NOTE: intentionally no push/remote — see file header. */
export interface LocalGitOps {
  init(dir: string): void;
  checkoutNewBranch(dir: string, branch: string): void;
  addAll(dir: string): void;
  commit(dir: string, message: string): void;
  headSha(dir: string): string;
  /** Full patch of the initial commit (for the PR-prep bundle). */
  rootPatch(dir: string): string;
}

function runGit(args: string[], cwd: string): { success: boolean; stdout: string; stderr: string } {
  // 64MB buffer: a full-scaffold root patch (hundreds of files) far exceeds spawnSync's 1MB default.
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
  return {
    success: (result.status ?? 1) === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim().slice(0, 200),
  };
}

function must(label: string, r: { success: boolean; stderr: string }): void {
  if (!r.success) throw new Error(`${label} failed: ${r.stderr}`);
}

export const realLocalGit: LocalGitOps = {
  init(dir: string): void {
    must("git init", runGit(["init"], dir));
    // Local identity for commit in clean/CI environments. No global config touched.
    runGit(["config", "user.email", "scaffold@hartos.local"], dir);
    runGit(["config", "user.name", "HartOS Scaffold"], dir);
    // Windows: scaffolds nest deeply; allow long paths for this repo (harmless elsewhere).
    runGit(["config", "core.longpaths", "true"], dir);
  },
  checkoutNewBranch(dir: string, branch: string): void {
    must("git checkout -b", runGit(["checkout", "-b", branch], dir));
  },
  addAll(dir: string): void {
    must("git add", runGit(["add", "."], dir));
  },
  commit(dir: string, message: string): void {
    must("git commit", runGit(["commit", "-m", message], dir));
  },
  headSha(dir: string): string {
    const r = runGit(["rev-parse", "HEAD"], dir);
    must("git rev-parse", r);
    return r.stdout;
  },
  rootPatch(dir: string): string {
    const r = runGit(["format-patch", "--root", "-1", "--stdout"], dir);
    must("git format-patch", r);
    return r.stdout;
  },
};
