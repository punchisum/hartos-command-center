/**
 * src/execution/self-mod-deploy-ports.ts — Phase 6 (Amendment §6): the REAL DeployPorts wiring.
 *
 * Composes the deploy net's ports from git (commit/push to trunk + revert), the wrangler deploy
 * primitive, the /health deployed-SHA verify, the armory disarm marker, and a Telegram notify.
 *
 * SAFETY (adversarial-review hardened):
 *   - commitPush stages ONLY the verified changed-file set (NEVER `git add -A`) and asserts the staged
 *     set equals it — so unverified cruft can't ride a commit to prod. Atomic: a push failure
 *     soft-resets the local commit so ok ⟺ the commit landed on the remote.
 *   - revert undoes the change (git revert — no history rewrite), asserts a CLEAN tree + that HEAD is on
 *     the deploy branch + that the reverted tree equals lastGood, then REDEPLOYS + RE-VERIFIES. ok:true
 *     only when prod is confirmed serving the reverted code. An empty range (nothing to revert) is a
 *     benign success.
 *   - The armory marker file MUST live OUTSIDE the repo working tree (the caller's responsibility) so a
 *     breaker write never dirties the tree or blocks the safety revert.
 * NODE HOST ONLY. STILL DISARMED — no caller wires this yet.
 */
import { spawnSync } from "node:child_process";
import { deployCloudflareWorker, wranglerRunnerInCwd, type WranglerRunner } from "./self-mod-deploy-worker.js";
import { checkDeployedSha, type FetchLike } from "./self-mod-deploy-health.js";
import type { DeployPorts } from "./self-mod-deploy.js";
import type { ArmoryStore } from "./self-mod-armory.js";

type Env = Record<string, string | undefined>;

/** Git operations the deploy ports need. Injectable so tests never touch a real repo. */
export interface GitDeployOps {
  /** Stage ONLY `paths`, commit, push to origin/<branch>; return the new HEAD sha. Asserts the staged
   *  set equals `paths`. Atomic: a push failure soft-resets the commit so ok ⟺ landed on the remote. */
  commitAndPush(cwd: string, branch: string, message: string, paths: string[]): { ok: boolean; sha: string; detail: string };
  /** Undo lastGoodSha..HEAD: assert clean tree + on-branch, git revert --no-edit, assert tree==lastGood,
   *  push origin/<branch>; return the new HEAD sha (the revert commit). Empty range ⇒ benign ok. */
  revertSince(cwd: string, branch: string, lastGoodSha: string): { ok: boolean; sha: string; detail: string };
}

function git(args: string[], cwd: string): { ok: boolean; stdout: string; detail: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return {
    ok: (r.status ?? 1) === 0,
    stdout: (r.stdout ?? "").trim(),
    detail: ((r.stderr ?? "") || (r.stdout ?? "")).trim().slice(0, 200),
  };
}

function porcelainPaths(stdout: string): string[] {
  return stdout.split("\n").map((l) => l.slice(3).trim()).filter((p) => p.length > 0);
}

export const realGitDeployOps: GitDeployOps = {
  commitAndPush(cwd, branch, message, paths) {
    if (paths.length === 0) return { ok: false, sha: "", detail: "no verified files to commit" };
    // Guard: HEAD must be on the deploy branch.
    const br = git(["symbolic-ref", "--short", "HEAD"], cwd);
    if (!br.ok || br.stdout !== branch) return { ok: false, sha: "", detail: `not on deploy branch (on "${br.stdout || "?"}", need "${branch}")` };
    // Stage ONLY the verified paths.
    const add = git(["add", "--", ...paths], cwd);
    if (!add.ok) return { ok: false, sha: "", detail: `git add: ${add.detail}` };
    // Assert the staged set equals the verified set (no extra/fewer files).
    const staged = git(["diff", "--cached", "--name-only"], cwd);
    if (!staged.ok) return { ok: false, sha: "", detail: `git diff --cached: ${staged.detail}` };
    const stagedSet = staged.stdout.split("\n").map((s) => s.trim()).filter(Boolean).sort();
    const want = [...paths].sort();
    if (stagedSet.length !== want.length || stagedSet.some((s, i) => s !== want[i])) {
      git(["reset"], cwd); // unstage — fail closed
      return { ok: false, sha: "", detail: `staged set ${JSON.stringify(stagedSet)} != verified ${JSON.stringify(want)}` };
    }
    const commit = git(["commit", "-m", message], cwd);
    if (!commit.ok) return { ok: false, sha: "", detail: `git commit: ${commit.detail}` };
    const push = git(["push", "origin", branch], cwd);
    if (!push.ok) {
      git(["reset", "--soft", "HEAD~1"], cwd); // undo the unpushed commit (keeps the changes in the tree)
      return { ok: false, sha: "", detail: `git push: ${push.detail}` };
    }
    const head = git(["rev-parse", "HEAD"], cwd);
    if (!head.ok) return { ok: false, sha: "", detail: `git rev-parse: ${head.detail}` };
    return { ok: true, sha: head.stdout, detail: "committed (verified paths only) + pushed" };
  },

  revertSince(cwd, branch, lastGoodSha) {
    // Guard: on the deploy branch.
    const br = git(["symbolic-ref", "--short", "HEAD"], cwd);
    if (!br.ok || br.stdout !== branch) return { ok: false, sha: "", detail: `not on deploy branch (on "${br.stdout || "?"}", need "${branch}")` };
    // Empty range (nothing landed since last-good) ⇒ benign success.
    const head0 = git(["rev-parse", "HEAD"], cwd);
    if (head0.ok && head0.stdout === lastGoodSha) return { ok: true, sha: lastGoodSha, detail: "nothing to revert (already at last-good)" };
    // Guard: clean tree, else the revert would conflict / sweep cruft.
    const status = git(["status", "--porcelain"], cwd);
    if (!status.ok) return { ok: false, sha: "", detail: `git status: ${status.detail}` };
    if (porcelainPaths(status.stdout).length > 0) return { ok: false, sha: "", detail: "working tree not clean — refusing to revert" };
    // Revert the commits since last-good (no history rewrite).
    const revert = git(["revert", "--no-edit", `${lastGoodSha}..HEAD`], cwd);
    if (!revert.ok) return { ok: false, sha: "", detail: `git revert: ${revert.detail}` };
    // Assert the reverted tree actually equals last-good (catches intervening/merge commits).
    const sameTree = git(["diff", "--quiet", lastGoodSha, "HEAD"], cwd);
    if (!sameTree.ok) {
      git(["reset", "--hard", lastGoodSha], cwd); // best-effort: restore local; do NOT push a wrong tree
      return { ok: false, sha: "", detail: "post-revert tree != last-good — aborted (did not push)" };
    }
    const push = git(["push", "origin", branch], cwd);
    if (!push.ok) return { ok: false, sha: "", detail: `git push (revert): ${push.detail}` };
    const head = git(["rev-parse", "HEAD"], cwd);
    if (!head.ok) return { ok: false, sha: "", detail: `git rev-parse: ${head.detail}` };
    return { ok: true, sha: head.stdout, detail: "reverted (tree==last-good) + pushed" };
  },
};

export interface DeployPortsDeps {
  cwd: string;
  env: Env;
  /** The deploy branch (trunk) — commits/reverts assert HEAD is on it and push to origin/<branch>. */
  deployBranch: string;
  /** The verified changed-file set — commitPush stages ONLY these. */
  changedFiles: string[];
  /** Base URL of the Worker whose /health reports the deployed SHA. */
  workerUrl: string;
  /** ISO build time injected as BUILD_TIME. */
  buildTime: string;
  /** Telegram notify/alert. */
  notify: (message: string) => Promise<void> | void;
  /** The disarm-marker store (the circuit breaker) — its file MUST live outside the repo working tree. */
  armory: ArmoryStore;
  git?: GitDeployOps;
  wrangler?: WranglerRunner;
  fetchFn?: FetchLike;
}

/** Build the real DeployPorts. commitPush stages only verified files; revert redeploys + re-verifies. */
export function defaultDeployPorts(deps: DeployPortsDeps): DeployPorts {
  const gitOps = deps.git ?? realGitDeployOps;
  // Pin wrangler's cwd to the repo root so the relative --config always resolves (Finding 2).
  const wrangler = deps.wrangler ?? wranglerRunnerInCwd(deps.cwd);
  const fetchFn = deps.fetchFn ?? (fetch as unknown as FetchLike);

  return {
    commitPush: () => gitOps.commitAndPush(deps.cwd, deps.deployBranch, "self-mod: auto-applied verified change", deps.changedFiles),

    deploy: (sha) => deployCloudflareWorker(sha, deps.env, deps.buildTime, wrangler),

    verify: async (sha) => {
      const r = await checkDeployedSha(deps.workerUrl, sha, fetchFn);
      return { ok: r.ok, detail: r.detail };
    },

    revert: async (lastGoodSha) => {
      const rv = gitOps.revertSince(deps.cwd, deps.deployBranch, lastGoodSha);
      if (!rv.ok) return { ok: false, detail: `git revert failed: ${rv.detail}` };
      const redeploy = deployCloudflareWorker(rv.sha, deps.env, deps.buildTime, wrangler);
      if (!redeploy.ok) return { ok: false, detail: `redeploy after revert failed: ${redeploy.detail}` };
      const reverify = await checkDeployedSha(deps.workerUrl, rv.sha, fetchFn);
      return reverify.ok
        ? { ok: true, detail: `reverted + redeployed + verified ${rv.sha}` }
        : { ok: false, detail: `revert re-verify failed (bad build may still be live): ${reverify.detail}` };
    },

    disarm: (reason) => deps.armory.setDisarmed(reason),

    notify: (message) => deps.notify(message),
  };
}
