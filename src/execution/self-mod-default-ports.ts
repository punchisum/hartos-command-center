/**
 * src/execution/self-mod-default-ports.ts — Phase 6: the REAL ports for executeSelfMod, wiring it to
 * the live amendment-gate (over env), pre/post-verify, the W3 hand, git, a SUBPROCESS test run, and
 * rollback. STILL DISARMED — isArmed is false unless the Constitutional Amendment §6 is approved AND
 * the class flag is armed AND the kill-switch is off (the amendment-gate's fail-closed default).
 * NODE HOST ONLY (spawns git/npm). Never the Worker.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isSelfModArmed } from "../doctrine/amendment-gate.js";
import { preVerifySelfMod } from "./self-mod-pre-verify.js";
import { postVerifySelfMod } from "./self-mod-post-verify.js";
import { rollbackSelfMod } from "./self-mod-rollback.js";
import { changedByRun, type ExecBaseline } from "./claude-exec-baseline.js";
import { runClaudeTask } from "./claude-task-executor.js";
import type { SelfModPorts } from "./self-mod-executor.js";

type Env = Record<string, string | undefined>;

/** Env flags that arm self-mod. ALL required (amendment + class flag), kill-switch must be off. Default OFF. */
export const SELFMOD_AMENDMENT_ENV = "HARTOS_SELFMOD_AMENDMENT_APPROVED";
export const SELFMOD_CLASS_FLAG_ENV = "HARTOS_ALLOW_SELF_MOD";
export const KILL_SWITCH_ENV = "HARTOS_EXECUTION_KILL_SWITCH";

/** Map env → the amendment-gate verdict. Exact "true"/"on" matches; anything else is fail-closed. */
export function selfModArmingFromEnv(env: Env): boolean {
  return isSelfModArmed({
    amendmentApproved: (env[SELFMOD_AMENDMENT_ENV] ?? "").trim() === "true",
    classFlagArmed: (env[SELFMOD_CLASS_FLAG_ENV] ?? "").trim() === "true",
    killSwitchOn: (env[KILL_SWITCH_ENV] ?? "").trim().toLowerCase() === "on",
  });
}

/** Scan the CURRENT content of the run's changed files for secrets. A clean baseline means any
 *  secret-shaped token here is from the run; reading content (not git diff) also covers untracked
 *  new files. Missing files (e.g. the original side of a rename) read as "". Never throws. */
export function changedFileContent(cwd: string, paths: string[]): string {
  return paths
    .map((p) => {
      try {
        const f = join(cwd, p);
        return existsSync(f) ? readFileSync(f, "utf8") : "";
      } catch {
        return "";
      }
    })
    .join("\n");
}

/** Run the test suite as a fresh subprocess — the real "doctrine holds + tests pass" gate (the suite
 *  includes the doctrine conformance test). ok iff the process exits 0. */
export function runTestSuite(cwd: string): { ok: boolean; detail: string } {
  const r = spawnSync("npm", ["test"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === "win32", // npm is npm.cmd on Windows
  });
  const ok = (r.status ?? 1) === 0;
  const tail = ((r.stdout ?? "") + (r.stderr ?? "")).replace(/\s+/g, " ").trim().slice(-200);
  return { ok, detail: ok ? "test suite passed" : `test suite failed: ${tail}` };
}

/** Build the real ports for one approved self-mod task. Disarmed unless env arms it. */
export function defaultSelfModPorts(task: string, cwd: string, env: Env = process.env): SelfModPorts {
  return {
    isArmed: () => selfModArmingFromEnv(env),
    preVerify: () => preVerifySelfMod(cwd),
    runHand: async () => {
      const r = await runClaudeTask(task, env);
      return { ok: r.ok, detail: r.detail };
    },
    changedFiles: (baseline: ExecBaseline) => changedByRun(cwd, baseline),
    diffText: (baseline: ExecBaseline) => changedFileContent(cwd, changedByRun(cwd, baseline)),
    runTests: () => runTestSuite(cwd),
    postVerify: (changed, diff) => postVerifySelfMod(changed, diff),
    rollback: (baseline, changed) => rollbackSelfMod(cwd, baseline, changed),
  };
}
