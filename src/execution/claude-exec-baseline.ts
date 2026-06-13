/**
 * src/execution/claude-exec-baseline.ts — W3: capture a git baseline for an execution run and
 * attribute the changed files to it. Injectable GitProbe so tests are hermetic (no real git).
 *
 * The hand edits the working tree (never commits/pushes). To make a run auditable, we record the
 * HEAD sha and the paths already dirty BEFORE the run; afterwards the files attributable to the run
 * are (dirty after) − (dirty before). W3 only CAPTURES this; P6's pre/post-verify enforce a clean
 * baseline + a rollback point on top of it. All git calls use spawnSync (no shell, no injection).
 */
import { spawnSync } from "node:child_process";

export interface GitProbe {
  /** `git rev-parse HEAD`. Throws if the cwd is not a git repo (an unauditable run must not proceed). */
  headSha(cwd: string): string;
  /** Porcelain dirty paths (untracked + modified), one path per entry. */
  dirtyPaths(cwd: string): string[];
}

export interface ExecBaseline {
  headSha: string;
  /** Paths already dirty before the run — NOT attributable to it. */
  preexistingDirty: string[];
}

function runGit(args: string[], cwd: string): { ok: boolean; stdout: string } {
  // 64MB buffer mirrors local-git.ts — large repos can emit big status/diff output.
  const r = spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
  return { ok: (r.status ?? 1) === 0, stdout: (r.stdout ?? "").trim() };
}

export const realGitProbe: GitProbe = {
  headSha(cwd: string): string {
    const r = runGit(["rev-parse", "HEAD"], cwd);
    if (!r.ok) throw new Error("git rev-parse HEAD failed (not a git repo?)");
    return r.stdout;
  },
  dirtyPaths(cwd: string): string[] {
    const r = runGit(["status", "--porcelain"], cwd);
    if (!r.ok) return [];
    // porcelain v1: 2-char status + space + path; strip the 3-char prefix.
    // LIMITATION (intentional for W3): this does NOT decode renames ("R  old -> new" is
    // recorded as one literal entry) or git's quoting of paths with special chars. That is
    // adequate for W3's audit LABEL of edit/write-only runs. P6's rollback keys real actions
    // off these paths, so it must switch to `git status --porcelain -z` (NUL-delimited) first.
    return r.stdout
      .split("\n")
      .map((l) => l.slice(3).trim())
      .filter((p) => p.length > 0);
  },
};

/** Capture the baseline before an execution run. Throws if HEAD can't be read (unauditable cwd). */
export function captureBaseline(cwd: string, git: GitProbe = realGitProbe): ExecBaseline {
  return { headSha: git.headSha(cwd), preexistingDirty: git.dirtyPaths(cwd) };
}

/** Files the run is responsible for = dirty-after minus the baseline's pre-existing dirty. */
export function changedByRun(cwd: string, baseline: ExecBaseline, git: GitProbe = realGitProbe): string[] {
  const before = new Set(baseline.preexistingDirty);
  return git.dirtyPaths(cwd).filter((p) => !before.has(p));
}
