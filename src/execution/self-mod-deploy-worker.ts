/**
 * src/execution/self-mod-deploy-worker.ts — Phase 6 (Amendment §6): the wrangler deploy primitive.
 *
 * Deploys the Cloudflare Worker for a given BUILD_SHA so /health then reports it (and checkDeployedSha
 * can verify the rollout actually landed). Gated by ALLOW_CLOUDFLARE_DEPLOY=true (default OFF ⇒ no-op).
 * Injectable runner so tests never spawn wrangler. NODE HOST ONLY. v1 deploys the WORKER runtime; a
 * daemon-code self-mod lands on trunk and is picked up on the daemon's next restart (not this primitive).
 */
import { spawnSync } from "node:child_process";

type Env = Record<string, string | undefined>;

/** Run wrangler with the given args; returns the process exit code + a short detail. Injectable for tests. */
export type WranglerRunner = (args: string[], env: Env) => { code: number; detail: string };

export const realWranglerRunner: WranglerRunner = (args, env) => {
  const r = spawnSync("wrangler", args, {
    encoding: "utf8",
    env: { ...process.env, ...env } as NodeJS.ProcessEnv,
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) return { code: 1, detail: (r.error as Error).message };
  return { code: r.status ?? 1, detail: ((r.stderr ?? "") || (r.stdout ?? "")).replace(/\s+/g, " ").trim().slice(-200) };
};

export interface DeployWorkerResult {
  ok: boolean;
  detail: string;
}

/** Deploy the Worker for `sha`. Gated by ALLOW_CLOUDFLARE_DEPLOY=true; APP_ENV=production targets prod. */
export function deployCloudflareWorker(sha: string, env: Env, buildTime: string, run: WranglerRunner = realWranglerRunner): DeployWorkerResult {
  if ((env.ALLOW_CLOUDFLARE_DEPLOY ?? "").trim() !== "true") {
    return { ok: false, detail: "deploy gated off (set ALLOW_CLOUDFLARE_DEPLOY=true)" };
  }
  const wranglerEnv = (env.APP_ENV ?? "").trim() === "production" ? "production" : "staging";
  const r = run(["deploy", "--env", wranglerEnv, "--var", `BUILD_SHA:${sha}`, "--var", `BUILD_TIME:${buildTime}`], env);
  return r.code === 0
    ? { ok: true, detail: `wrangler deploy → ${wranglerEnv} (BUILD_SHA ${sha})` }
    : { ok: false, detail: `wrangler deploy failed (code ${r.code}): ${r.detail}` };
}
