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
  // DO NOT trim here. `git status --porcelain -z` encodes the index/worktree status in the FIRST TWO
  // columns, and for a worktree-only change column 1 is a SIGNIFICANT SPACE (" M path"). A leading
  // trim() would eat that space, shifting parsePorcelainZ's slice(3) by one and corrupting EVERY path
  // ("src/…" → "rc/…") — which silently breaks scope-verify AND rollback. Callers trim where it's safe.
  return { ok: (r.status ?? 1) === 0, stdout: r.stdout ?? "" };
}

export const realGitProbe: GitProbe = {
  headSha(cwd: string): string {
    const r = runGit(["rev-parse", "HEAD"], cwd);
    if (!r.ok) throw new Error("git rev-parse HEAD failed (not a git repo?)");
    return r.stdout.trim(); // rev-parse emits a trailing newline — safe to trim a plain sha
  },
  dirtyPaths(cwd: string): string[] {
    // -z: NUL-delimited, so paths with spaces/unicode are NOT C-quoted, and a rename/copy emits
    // both the new path and (as the next NUL field) the original. This is what makes the set
    // rename-/special-char-safe for P6's rollback, which keys real file actions off these paths.
    const r = runGit(["status", "--porcelain", "-z"], cwd);
    if (!r.ok) return [];
    return parsePorcelainZ(r.stdout);
  },
};

/**
 * Parse `git status --porcelain -z` output into the set of affected paths. Each record is
 * `XY␠PATH` NUL-terminated; a rename/copy (index status R or C) appends the ORIGINAL path as the
 * next NUL field — both the new and the original path are emitted so a run-rename is fully
 * attributable AND reversible (restore the original, remove the new). Pure + exported for testing.
 */
export function parsePorcelainZ(stdout: string): string[] {
  const tokens = stdout.split("\0").filter((t) => t.length > 0);
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    const status = entry[0];
    const path = entry.slice(3); // "XY " prefix (2 status chars + space)
    if (path) paths.push(path);
    if (status === "R" || status === "C") {
      i += 1; // the next NUL field is the bare original path
      const orig = tokens[i];
      if (orig) paths.push(orig);
    }
  }
  return paths;
}

/** Capture the baseline before an execution run. Throws if HEAD can't be read (unauditable cwd). */
export function captureBaseline(cwd: string, git: GitProbe = realGitProbe): ExecBaseline {
  return { headSha: git.headSha(cwd), preexistingDirty: git.dirtyPaths(cwd) };
}

/** Files the run is responsible for = dirty-after minus the baseline's pre-existing dirty. */
export function changedByRun(cwd: string, baseline: ExecBaseline, git: GitProbe = realGitProbe): string[] {
  const before = new Set(baseline.preexistingDirty);
  return git.dirtyPaths(cwd).filter((p) => !before.has(p));
}
