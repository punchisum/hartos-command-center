/**
 * src/execution/self-mod-deploy-ports.ts — Phase 6 (Amendment §6): the REAL DeployPorts wiring.
 *
 * Composes the deploy net's ports from git (commit/push to trunk + revert), the wrangler deploy
 * primitive, the /health deployed-SHA verify, the armory disarm marker, and a Telegram notify.
 * The REVERT honors the safety contract: undo the bad change (git revert — no history rewrite),
 * REDEPLOY the reverted state, and RE-VERIFY prod is serving it; only then is the revert "ok".
 * commitPush is atomic: a push failure soft-resets the local commit so ok ⟺ landed-on-remote.
 * NODE HOST ONLY. STILL DISARMED — no caller wires this yet.
 */
import { spawnSync } from "node:child_process";
import { deployCloudflareWorker, realWranglerRunner, type WranglerRunner } from "./self-mod-deploy-worker.js";
import { checkDeployedSha, type FetchLike } from "./self-mod-deploy-health.js";
import type { DeployPorts } from "./self-mod-deploy.js";
import type { ArmoryStore } from "./self-mod-armory.js";

type Env = Record<string, string | undefined>;

/** Git operations the deploy ports need. Injectable so tests never touch a real repo. */
export interface GitDeployOps {
  /** Stage all changes, commit, push to the deploy branch; return the new HEAD sha. Atomic: a push
   *  failure soft-resets the commit so ok ⟺ the commit actually landed on the remote. */
  commitAndPush(cwd: string, message: string): { ok: boolean; sha: string; detail: string };
  /** git revert --no-edit <lastGoodSha>..HEAD + push; return the new HEAD sha (the revert commit). */
  revertSince(cwd: string, lastGoodSha: string): { ok: boolean; sha: string; detail: string };
}

function git(args: string[], cwd: string): { ok: boolean; stdout: string; detail: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return {
    ok: (r.status ?? 1) === 0,
    stdout: (r.stdout ?? "").trim(),
    detail: ((r.stderr ?? "") || (r.stdout ?? "")).trim().slice(0, 200),
  };
}

export const realGitDeployOps: GitDeployOps = {
  commitAndPush(cwd, message) {
    const add = git(["add", "-A"], cwd);
    if (!add.ok) return { ok: false, sha: "", detail: `git add: ${add.detail}` };
    const commit = git(["commit", "-m", message], cwd);
    if (!commit.ok) return { ok: false, sha: "", detail: `git commit: ${commit.detail}` };
    const push = git(["push"], cwd);
    if (!push.ok) {
      // Atomicity: the commit is local-only — undo it so ok:false ⟺ nothing landed on the remote.
      git(["reset", "--soft", "HEAD~1"], cwd);
      return { ok: false, sha: "", detail: `git push: ${push.detail}` };
    }
    const head = git(["rev-parse", "HEAD"], cwd);
    if (!head.ok) return { ok: false, sha: "", detail: `git rev-parse: ${head.detail}` };
    return { ok: true, sha: head.stdout, detail: "committed + pushed" };
  },
  revertSince(cwd, lastGoodSha) {
    const revert = git(["revert", "--no-edit", `${lastGoodSha}..HEAD`], cwd);
    if (!revert.ok) return { ok: false, sha: "", detail: `git revert: ${revert.detail}` };
    const push = git(["push"], cwd);
    if (!push.ok) return { ok: false, sha: "", detail: `git push (revert): ${push.detail}` };
    const head = git(["rev-parse", "HEAD"], cwd);
    if (!head.ok) return { ok: false, sha: "", detail: `git rev-parse: ${head.detail}` };
    return { ok: true, sha: head.stdout, detail: "reverted + pushed" };
  },
};

export interface DeployPortsDeps {
  cwd: string;
  env: Env;
  /** Base URL of the Worker whose /health reports the deployed SHA. */
  workerUrl: string;
  /** ISO build time injected as BUILD_TIME. */
  buildTime: string;
  /** Telegram notify/alert. */
  notify: (message: string) => Promise<void> | void;
  /** The disarm-marker store (the circuit breaker). */
  armory: ArmoryStore;
  git?: GitDeployOps;
  wrangler?: WranglerRunner;
  fetchFn?: FetchLike;
}

/** Build the real DeployPorts. The revert REDEPLOYS + RE-VERIFIES the reverted sha (safety contract). */
export function defaultDeployPorts(deps: DeployPortsDeps): DeployPorts {
  const gitOps = deps.git ?? realGitDeployOps;
  const wrangler = deps.wrangler ?? realWranglerRunner;
  const fetchFn = deps.fetchFn ?? (fetch as unknown as FetchLike);

  return {
    commitPush: () => gitOps.commitAndPush(deps.cwd, "self-mod: auto-applied verified change"),

    deploy: (sha) => deployCloudflareWorker(sha, deps.env, deps.buildTime, wrangler),

    verify: async (sha) => {
      const r = await checkDeployedSha(deps.workerUrl, sha, fetchFn);
      return { ok: r.ok, detail: r.detail };
    },

    revert: async (lastGoodSha) => {
      const rv = gitOps.revertSince(deps.cwd, lastGoodSha);
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
