/**
 * src/execution/self-mod-deploy-worker.ts — Phase 6 (Amendment §6): the wrangler deploy primitive.
 *
 * Deploys the Cloudflare Worker for a given BUILD_SHA so /health then reports it (and checkDeployedSha
 * can verify the rollout actually landed). Gated by ALLOW_CLOUDFLARE_DEPLOY=true (default OFF ⇒ no-op).
 * Injectable runner so tests never spawn wrangler. NODE HOST ONLY. v1 deploys the WORKER runtime; a
 * daemon-code self-mod lands on trunk and is picked up on the daemon's next restart (not this primitive).
 *
 * TARGET: the hosted cockpit Worker defined by wrangler.cockpit.toml — a SINGLE worker
 * ("hartos-command-center") with a top-level [vars] APP_ENV="production" and NO [env.*] sections. So we
 * deploy the TOP-LEVEL worker via `--config wrangler.cockpit.toml` and deliberately pass NO `--env`: a
 * `--env X` would deploy a DIFFERENT, "-X"-suffixed worker (e.g. hartos-command-center-staging) instead
 * of the live one. The runner inherits the daemon's cwd (the repo root, set by the launcher), so the
 * relative config path resolves correctly.
 */
import { spawnSync } from "node:child_process";

type Env = Record<string, string | undefined>;

/** The deploy target identity — kept in ONE place so the deploy and the post-deploy verify can never
 *  drift onto different workers. The config deploys the worker; the URL is where /health is checked. */
export const WRANGLER_COCKPIT_CONFIG = "wrangler.cockpit.toml";
/** The live cockpit Worker's URL (workers.dev). /health here must report the just-deployed BUILD_SHA. */
export const PROD_COCKPIT_WORKER_URL = "https://hartos-command-center.hartos.workers.dev";

/** Run wrangler with the given args; returns the process exit code + a short detail. Injectable for tests. */
export type WranglerRunner = (args: string[], env: Env) => { code: number; detail: string };

function runWrangler(args: string[], env: Env, cwd?: string): { code: number; detail: string } {
  const r = spawnSync("wrangler", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env } as NodeJS.ProcessEnv,
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) return { code: 1, detail: (r.error as Error).message };
  return { code: r.status ?? 1, detail: ((r.stderr ?? "") || (r.stdout ?? "")).replace(/\s+/g, " ").trim().slice(-200) };
}

export const realWranglerRunner: WranglerRunner = (args, env) => runWrangler(args, env);

/** A wrangler runner PINNED to `cwd`, so the relative `--config wrangler.cockpit.toml` resolves against
 *  the repo root regardless of the daemon's process.cwd(). Use this on the host path (Finding 2). */
export function wranglerRunnerInCwd(cwd: string): WranglerRunner {
  return (args, env) => runWrangler(args, env, cwd);
}

export interface DeployWorkerResult {
  ok: boolean;
  detail: string;
}

/** Deploy the hosted cockpit Worker for `sha`. Gated by ALLOW_CLOUDFLARE_DEPLOY=true (default OFF ⇒ no-op).
 *  Deploys the top-level worker in wrangler.cockpit.toml (no `--env`; see file header). The injected
 *  BUILD_SHA is what /health then reports, so checkDeployedSha(sha) can confirm the rollout landed. */
export function deployCloudflareWorker(sha: string, env: Env, buildTime: string, run: WranglerRunner = realWranglerRunner): DeployWorkerResult {
  if ((env.ALLOW_CLOUDFLARE_DEPLOY ?? "").trim() !== "true") {
    return { ok: false, detail: "deploy gated off (set ALLOW_CLOUDFLARE_DEPLOY=true)" };
  }
  const r = run(["deploy", "--config", WRANGLER_COCKPIT_CONFIG, "--var", `BUILD_SHA:${sha}`, "--var", `BUILD_TIME:${buildTime}`], env);
  return r.code === 0
    ? { ok: true, detail: `wrangler deploy → hartos-command-center (BUILD_SHA ${sha})` }
    : { ok: false, detail: `wrangler deploy failed (code ${r.code}): ${r.detail}` };
}
