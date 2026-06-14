/**
 * scripts/run-self-mod-pass.ts — P6 §6: the self-mod pass host glue (disarmed, gated no-op).
 *
 * Assembles the real SelfModPassDeps from the already-built components and runs one self-mod
 * pass. DISARMED by default: returns [] unless HARTOS_SELFMOD_AMENDMENT_APPROVED=true AND
 * HARTOS_ALLOW_SELF_MOD=true (AND HARTOS_EXECUTION_KILL_SWITCH != on).
 *
 * nextSelfModTask: pops the next entry from Hart's out-of-repo queue file
 * (~/.hartos-self-mod-queue.json). A missing/empty/malformed queue → null (silent no-op).
 *
 * NODE EXECUTION HOST ONLY. Never the Worker.
 */

import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { selfModArmingFromEnv, defaultSelfModPorts, changedFileContent } from "../src/execution/self-mod-default-ports.js";
import { executeSelfMod } from "../src/execution/self-mod-executor.js";
import { runSelfModPass, type SelfModTask, type SelfModPassDeps } from "../src/execution/self-mod-pass.js";
import { classifyTier } from "../src/execution/self-mod-classifier.js";
import { canAutoApply } from "../src/execution/self-mod-armory.js";
import { fileArmoryStore } from "../src/execution/self-mod-armory-store.js";
import { deployAndVerifySelfMod } from "../src/execution/self-mod-deploy.js";
import { defaultDeployPorts } from "../src/execution/self-mod-deploy-ports.js";
import { captureBaseline } from "../src/execution/claude-exec-baseline.js";
import { rollbackSelfMod } from "../src/execution/self-mod-rollback.js";
import { createSelfModProposal } from "../src/execution/self-mod-proposal.js";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import { redact } from "../src/llm/redaction.js";
import { TelegramHttpSender } from "../src/telegram/sender.js";
import { telegramNotifyConfig } from "../src/telegram/alert-bus.js";

type Env = Record<string, string | undefined>;

/** Minimal fs seam so the queue reader is unit-testable without touching disk. */
export interface QueueFs {
  exists(p: string): boolean;
  read(p: string): string;
  write(p: string, data: string): void;
}
const realQueueFs: QueueFs = {
  exists: (p) => existsSync(p),
  read: (p) => readFileSync(p, "utf8"),
  write: (p, d) => writeFileSync(p, d, "utf8"),
};

/** Path of the Hart-controlled self-mod task queue (OUTSIDE the repo so it never dirties the tree). */
export function selfModQueuePath(): string {
  return path.join(os.homedir(), ".hartos-self-mod-queue.json");
}

function isValidTask(t: unknown): t is SelfModTask {
  return (
    Boolean(t) &&
    typeof t === "object" &&
    ["fix", "recalibrate", "extend"].includes((t as SelfModTask).selfModClass) &&
    typeof (t as SelfModTask).description === "string" &&
    (t as SelfModTask).description.trim().length > 0
  );
}

/**
 * The self-mod TRIGGER: pop the next Hart-queued task from the out-of-repo queue file (FIFO).
 * Hart controls WHAT self-mod attempts by writing a JSON array of {selfModClass, description} to
 * selfModQueuePath(); the daemon takes one per pass. A bad/absent/empty queue → null (no-op). Never throws.
 */
export function nextSelfModTask(env: Env, fs: QueueFs = realQueueFs): SelfModTask | null {
  void env;
  const p = selfModQueuePath();
  if (!fs.exists(p)) return null;
  let queue: unknown;
  try { queue = JSON.parse(fs.read(p)); } catch { return null; }
  if (!Array.isArray(queue) || queue.length === 0) return null;
  const [head, ...rest] = queue;
  try { fs.write(p, JSON.stringify(rest, null, 2)); } catch { /* best-effort pop */ }
  return isValidTask(head) ? head : null;
}

/**
 * Run one self-mod pass. DISARMED → silent []. No queued task → silent [].
 * When armed + a task exists, assembles real deps and runs the full orchestration.
 * Never throws — errors are caught and returned as a single-element array.
 */
export async function runSelfModPassOnce(env: Env, now: Date): Promise<string[]> {
  // 1. Disarmed → silent no-op (do NOT touch git or build any deps).
  if (!selfModArmingFromEnv(env)) return [];

  // 2. No queued task → silent no-op.
  const task = nextSelfModTask(env);
  if (!task) return [];

  // Armed + a task: build real deps and run.
  try {
    const cwd = process.cwd();
    const baseline = captureBaseline(cwd);
    const lastGoodSha = baseline.headSha;

    // Armory marker MUST live outside the repo working tree so it never dirties the tracked files.
    const markerPath = path.join(os.homedir(), ".hartos-self-mod-state.json");
    const armory = fileArmoryStore(markerPath);

    const deployBranch = "feat/cloudflare-hosted-command-center"; // trunk

    // The Worker URL: prefer the staging variant; fall back to the plain var (mirrors run-staging-smoke.ts).
    const workerUrl = (env["STAGING_CLOUDFLARE_WORKER_URL"] ?? env["CLOUDFLARE_WORKER_URL"] ?? "").trim();

    // notify(msg): send a Telegram message when configured, else silent no-op; never throws.
    const notifyCfg = telegramNotifyConfig(env);
    const notify = async (msg: string): Promise<void> => {
      if (!notifyCfg.ok || !notifyCfg.chatId) return;
      try {
        const sender = new TelegramHttpSender(env as Record<string, string>);
        await sender.sendMessage(notifyCfg.chatId, msg);
      } catch {
        // best-effort; never propagate
      }
    };

    // changedLines: sum added + removed from `git diff --numstat` of the working tree.
    // Best-effort: returns 0 on any error.
    const changedLines = (): number => {
      try {
        const r = spawnSync("git", ["diff", "--numstat"], {
          cwd,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
          shell: process.platform === "win32",
        });
        if ((r.status ?? 1) !== 0 || !r.stdout) return 0;
        return r.stdout
          .split("\n")
          .filter(Boolean)
          .reduce((acc, line) => {
            const parts = line.split("\t");
            const added = parseInt(parts[0] ?? "0", 10);
            const removed = parseInt(parts[1] ?? "0", 10);
            return acc + (isNaN(added) ? 0 : added) + (isNaN(removed) ? 0 : removed);
          }, 0);
      } catch {
        return 0;
      }
    };

    const deps: SelfModPassDeps = {
      lastGoodSha,
      now: now.getTime(),

      runGauntlet: () => executeSelfMod(defaultSelfModPorts(task.description, cwd, env)),

      changedLines,

      classify: (cls, files, lines) => classifyTier({ selfModClass: cls, fileCount: files, changedLines: lines }),

      canAutoApply: () => canAutoApply(now.getTime(), armory),

      deploy: (lg, changed) =>
        deployAndVerifySelfMod(
          lg,
          defaultDeployPorts({
            cwd,
            env,
            deployBranch,
            changedFiles: changed,
            workerUrl,
            buildTime: now.toISOString(),
            notify,
            armory,
          }),
        ),

      recordAutoDeploy: (at) => armory.recordAutoDeploy(at),

      captureDiff: (changed) => changedFileContent(cwd, changed),

      propose: async (t, tier, diff) => {
        const h = createCockpitProposalDb(env as NodeJS.ProcessEnv);
        if (!h) return;
        try {
          await createSelfModProposal(h.store, t, tier, diff, now);
        } finally {
          await h.close();
        }
      },

      rollback: (changed) => {
        rollbackSelfMod(cwd, baseline, changed);
      },
    };

    const r = await runSelfModPass(task, deps);
    return [`self-mod · ${r.action}${r.tier ? ` (${r.tier})` : ""} · ${r.detail}`];
  } catch (e) {
    return [`self-mod pass error: ${redact(String(e instanceof Error ? e.message : e))}`];
  }
}

const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runSelfModPassOnce(process.env, new Date())
    .then((lines) => { for (const l of lines) console.log(l); })
    .catch((err) => { console.error(`self-mod-pass failed: ${redact(err instanceof Error ? err.message : String(err))}`); process.exit(1); });
}
