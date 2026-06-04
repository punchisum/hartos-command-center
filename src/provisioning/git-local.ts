/**
 * src/provisioning/git-local.ts
 *
 * Safe git local operations for the provisioning engine.
 *
 * All commands use spawnSync (not shell) to avoid injection.
 * No git command prints tokens or secrets.
 * Exported as an injectable interface so tests can mock git operations.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Injectable interface for git operations (enables test mocking). */
export interface GitLocalOps {
  hasGitRepo(dir: string): boolean;
  getRemoteOrigin(dir: string): string | null;
  setRemoteOrigin(dir: string, url: string): void;
  hasCommits(dir: string): boolean;
  addAll(dir: string): void;
  commit(dir: string, message: string): void;
  push(dir: string, branch: string): void;
}

// ─── Internal helper ──────────────────────────────────────────────────────────

function runGit(
  args: string[],
  cwd: string
): { success: boolean; stdout: string; stderr: string } {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  return {
    success: (result.status ?? 1) === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim().slice(0, 200), // truncate stderr for safety
  };
}

// ─── Exported functions ───────────────────────────────────────────────────────

export function hasGitRepo(dir: string): boolean {
  return existsSync(path.join(dir, ".git"));
}

export function getRemoteOrigin(dir: string): string | null {
  const result = runGit(["remote", "get-url", "origin"], dir);
  return result.success ? result.stdout : null;
}

export function setRemoteOrigin(dir: string, url: string): void {
  const result = runGit(["remote", "add", "origin", url], dir);
  if (!result.success) {
    throw new Error(`Failed to set git remote origin: ${result.stderr}`);
  }
}

export function hasCommits(dir: string): boolean {
  const result = runGit(["log", "--oneline", "-1"], dir);
  return result.success && result.stdout.length > 0;
}

export function addAll(dir: string): void {
  const result = runGit(["add", "."], dir);
  if (!result.success) {
    throw new Error(`git add failed: ${result.stderr}`);
  }
}

export function commit(dir: string, message: string): void {
  // Configure a local identity if not already set (CI environments)
  const nameResult = runGit(["config", "user.name"], dir);
  if (!nameResult.success || !nameResult.stdout) {
    runGit(["config", "user.email", "provision@hartos.local"], dir);
    runGit(["config", "user.name", "HartOS Provision"], dir);
  }
  const result = runGit(["commit", "-m", message], dir);
  if (!result.success) {
    throw new Error(`git commit failed: ${result.stderr}`);
  }
}

export function push(dir: string, branch: string): void {
  const result = runGit(["push", "-u", "origin", branch], dir);
  if (!result.success) {
    throw new Error(`git push failed: ${result.stderr}`);
  }
}

// ─── Default implementation ───────────────────────────────────────────────────

/** The default real git operations. Pass to GitHubAdapter constructor. */
export const realGitOps: GitLocalOps = {
  hasGitRepo,
  getRemoteOrigin,
  setRemoteOrigin,
  hasCommits,
  addAll,
  commit,
  push,
};

/** Create a no-op mock for tests that don't need git. */
export function createMockGitOps(
  overrides: Partial<GitLocalOps> = {}
): GitLocalOps {
  return {
    hasGitRepo: () => false,
    getRemoteOrigin: () => null,
    setRemoteOrigin: () => {},
    hasCommits: () => false,
    addAll: () => {},
    commit: () => {},
    push: () => {},
    ...overrides,
  };
}
