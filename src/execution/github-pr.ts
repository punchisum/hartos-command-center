/**
 * src/execution/github-pr.ts
 *
 * Phase 18B — injectable GitHub PR operations. This is the ONLY network-touching code in the agent
 * creation pipeline, and it runs only when every 18B gate is open (see run-github-pr.ts). The
 * interface is dependency-injected so all tests use a mock and perform ZERO network I/O.
 *
 * Boundaries: push a branch + open/close a PR + delete a remote branch against an EXISTING repo.
 * It does NOT create a repo, merge a PR, provision any provider, or write provider secrets. The
 * token is read from host env, never logged, never committed, and scrubbed from any error output.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

export interface PushScaffoldInput {
  /** The 18A scaffold workdir whose FILES (minus .git) are laid on top of the base branch. */
  scaffoldDir: string;
  /** A scratch dir for the rebased-on-base branch (gitignored). */
  prepDir: string;
  owner: string;
  repo: string;
  branch: string;
  /** The existing base branch to descend from (e.g. main) — gives the branch shared history for the PR. */
  base: string;
  token: string;
  /** Commit message for the scaffold commit on top of base. */
  message: string;
}

export interface OpenPrInput {
  owner: string;
  repo: string;
  token: string;
  head: string;
  base: string;
  title: string;
  body: string;
}

export interface OpenPrResult {
  url: string;
  number: number;
}

export interface ClosePrInput {
  owner: string;
  repo: string;
  token: string;
  number: number;
}

export interface DeleteRemoteBranchInput {
  owner: string;
  repo: string;
  token: string;
  branch: string;
}

/** Injectable GitHub operations. Tests pass a mock; the real impl below is reached only when gated. */
export interface GitHubPrOps {
  /**
   * Create the scaffold branch FROM the existing base branch (shared history → PR-able), lay the
   * scaffold files on top, commit, and push. Replaces a naive orphan-branch push.
   */
  pushScaffoldOntoBase(input: PushScaffoldInput): Promise<void>;
  openPullRequest(input: OpenPrInput): Promise<OpenPrResult>;
  closePullRequest(input: ClosePrInput): Promise<void>;
  deleteRemoteBranch(input: DeleteRemoteBranchInput): Promise<void>;
}

/** Remove the token from any string before it is surfaced/logged. */
function scrub(text: string, token: string): string {
  if (!token) return text;
  return text.split(token).join("***");
}

async function githubApi(
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "hartos-command-center",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

/**
 * Real GitHub operations — REST via fetch + a single one-shot `git push` (token in an ephemeral URL,
 * never written to .git/config and scrubbed from any error). Reached ONLY behind open 18B gates.
 */
/** Run a git command; throw on failure with the token scrubbed from output. */
function git(args: string[], cwd: string, token: string): void {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    maxBuffer: 64 * 1024 * 1024,
  });
  if ((r.status ?? 1) !== 0) {
    const out = scrub(((r.stderr ?? "") + (r.stdout ?? "")).trim(), token).slice(0, 300);
    // Never echo the args (they may contain the authed URL) — only the first token.
    throw new Error(`git ${args[0]} failed: ${out}`);
  }
}

export const realGitHubPrOps: GitHubPrOps = {
  async pushScaffoldOntoBase({ scaffoldDir, prepDir, owner, repo, branch, base, token, message }: PushScaffoldInput): Promise<void> {
    // One-shot authenticated URL — used directly in fetch/push, never persisted as a named remote
    // (so the token never lands in .git/config).
    const url = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;

    // Fresh prep repo seeded from the EXISTING base branch → the scaffold branch shares history with it.
    rmSync(prepDir, { recursive: true, force: true });
    mkdirSync(prepDir, { recursive: true });
    git(["init"], prepDir, token);
    git(["config", "user.email", "scaffold@hartos.local"], prepDir, token);
    git(["config", "user.name", "HartOS Scaffold"], prepDir, token);
    git(["config", "core.longpaths", "true"], prepDir, token);
    git(["fetch", "--depth", "1", url, base], prepDir, token);
    git(["checkout", "-b", branch, "FETCH_HEAD"], prepDir, token);

    // Lay the scaffold files (excluding its orphan .git) on top of base, then commit + push.
    cpSync(scaffoldDir, prepDir, {
      recursive: true,
      filter: (src) => !src.split(path.sep).includes(".git"),
    });
    git(["add", "-A"], prepDir, token);
    git(["commit", "-m", message], prepDir, token);
    git(["push", url, `${branch}:${branch}`], prepDir, token);
  },

  async openPullRequest({ owner, repo, token, head, base, title, body }: OpenPrInput): Promise<OpenPrResult> {
    const { status, json, text } = await githubApi("POST", `/repos/${owner}/${repo}/pulls`, token, {
      title,
      head,
      base,
      body,
    });
    if (status < 200 || status >= 300) {
      throw new Error(`GitHub PR creation failed (${status}): ${scrub(text, token).slice(0, 300)}`);
    }
    const obj = (json ?? {}) as { html_url?: string; number?: number };
    if (!obj.html_url || typeof obj.number !== "number") {
      throw new Error("GitHub PR creation returned an unexpected payload.");
    }
    return { url: obj.html_url, number: obj.number };
  },

  async closePullRequest({ owner, repo, token, number }: ClosePrInput): Promise<void> {
    const { status, text } = await githubApi("PATCH", `/repos/${owner}/${repo}/pulls/${number}`, token, {
      state: "closed",
    });
    if (status < 200 || status >= 300) {
      throw new Error(`GitHub PR close failed (${status}): ${scrub(text, token).slice(0, 300)}`);
    }
  },

  async deleteRemoteBranch({ owner, repo, token, branch }: DeleteRemoteBranchInput): Promise<void> {
    const { status, text } = await githubApi(
      "DELETE",
      `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
      token
    );
    if (status < 200 || status >= 300) {
      throw new Error(`GitHub remote branch delete failed (${status}): ${scrub(text, token).slice(0, 300)}`);
    }
  },
};
