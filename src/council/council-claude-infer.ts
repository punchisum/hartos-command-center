/**
 * src/council/council-claude-infer.ts — council specialist Infer via headless Claude on Max.
 *
 * councilClaudeInfer: spawns `claude -p --output-format json` (pure reasoning; headless `-p` with the
 * default permission-mode grants no tool execution). Auth identical to the execution hand:
 * CLAUDE_CODE_OAUTH_TOKEN from env, ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN stripped (so the Max-plan
 * OAuth is used, never a pay-as-you-go API key).
 *
 * On success:  returns the model's `result` text (expected to be a JSON specialist finding that
 *              parseFinding in specialist-prompts.ts will parse).
 * On failure:  returns the non-JSON sentinel "(claude-infer failed)" — parseFinding degrades
 *              honestly to confidence "low". Never throws.
 *
 * Concurrency cap: council fans out specialists concurrently.  A module-level semaphore limits
 * simultaneous claude spawns to COUNCIL_CLAUDE_MAX_CONCURRENCY (default 3, env-overridable).
 * Excess callers queue without delay; the semaphore releases as soon as a slot frees.
 *
 * NODE HOST ONLY — spawns a child process. Never imported from the Worker.
 */

import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Infer } from "./specialist.js";

// ── Sentinel ──────────────────────────────────────────────────────────────────
/** Returned on any failure so parseFinding degrades honestly. Never valid JSON. */
export const CLAUDE_INFER_SENTINEL = "(claude-infer failed)";

// ── Concurrency cap ───────────────────────────────────────────────────────────
/** Default max concurrent headless-claude spawns for council specialists. */
export const COUNCIL_CLAUDE_MAX_CONCURRENCY = 3;

type Release = () => void;

/** Simple async semaphore: callers await acquire(); release() when done. */
function makeSemaphore(limit: number): { acquire(): Promise<Release> } {
  let slots = limit;
  const queue: Array<() => void> = [];
  return {
    acquire(): Promise<Release> {
      return new Promise((resolve) => {
        const tryAcquire = () => {
          if (slots > 0) {
            slots--;
            resolve(() => {
              slots++;
              const next = queue.shift();
              if (next) next();
            });
          } else {
            queue.push(tryAcquire);
          }
        };
        tryAcquire();
      });
    },
  };
}

// Module-level semaphore; the limit is read once at module load so that tests can
// inject HARTOS_COUNCIL_MAX_CONCURRENCY via the env parameter on councilClaudeInfer.
// The per-infer semaphore is created inside councilClaudeInfer so the cap comes from env.
// (Module-level default exported for tests that want the raw constant.)

// ── ClaudeRunner (injectable seam) ───────────────────────────────────────────

/**
 * The injectable spawn seam.  The default implementation shells out to the real `claude` CLI.
 * Tests inject a fake (so no real claude is ever spawned in CI).
 */
export type ClaudeRunner = (
  prompt: string,
  opts: { model: string; token: string; timeoutMs: number },
) => Promise<{ ok: boolean; text: string }>;

/** Default runner — spawns `claude -p --output-format json` (pure reasoning, no tools granted). */
export const spawnCouncilClaudeRunner: ClaudeRunner = (prompt, { model, token, timeoutMs }) =>
  new Promise((resolve) => {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token };
    delete childEnv["ANTHROPIC_API_KEY"];
    delete childEnv["ANTHROPIC_AUTH_TOKEN"];

    // Prompt via a TEMP FILE + shell stdin-redirect (`claude -p … < file`), NOT node's child.stdin:
    // through Windows' cmd shim (shell:true) the piped child.stdin does not reach the claude process,
    // so it blocks forever on stdin. A `< file` redirect is delivered by the shell itself (reliable
    // cross-platform) and avoids any shell-quoting of the long specialist prompt. Pure reasoning, no
    // tools granted (headless `-p` grants no tool execution without acceptEdits / skip-permissions).
    const promptFile = join(tmpdir(), `hartos-council-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      try {
        unlinkSync(promptFile);
      } catch {
        /* best-effort */
      }
    };
    try {
      writeFileSync(promptFile, prompt, "utf8");
    } catch {
      resolve({ ok: false, text: "prompt write failed" });
      return;
    }
    const cmd = `claude -p --output-format json --model ${model} < "${promptFile}"`;
    const child = spawn(cmd, { env: childEnv, shell: true });

    let out = "";
    let settled = false;
    const done = (v: { ok: boolean; text: string }) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve(v);
      }
    };

    const timer = setTimeout(() => {
      child.kill();
      done({ ok: false, text: "timeout" });
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => (out += chunk.toString()));
    child.on("error", () => done({ ok: false, text: "spawn error" }));
    child.on("close", () => {
      try {
        const envelope = JSON.parse(out) as { is_error?: boolean; result?: unknown };
        const ok = envelope.is_error !== true && typeof envelope.result === "string" && envelope.result.length > 0;
        done({ ok, text: ok ? (envelope.result as string) : out.slice(0, 200) });
      } catch {
        done({ ok: false, text: out.slice(0, 200) });
      }
    });
  });

// ── Main export ───────────────────────────────────────────────────────────────

export interface CouncilClaudeInferOptions {
  /** Override the injected spawn runner (for tests). */
  runner?: ClaudeRunner;
}

/**
 * Build a council-scoped Infer backed by headless Claude on Max.
 *
 * @param env   Process environment (at least CLAUDE_CODE_OAUTH_TOKEN for the real path).
 * @param opts  Optional: inject a fake runner for tests.
 * @returns     Infer function that returns raw model text on success, or CLAUDE_INFER_SENTINEL on
 *              any failure.  Never throws.
 */
export function councilClaudeInfer(
  env: Record<string, string | undefined>,
  opts?: CouncilClaudeInferOptions,
): Infer {
  const token = (env["CLAUDE_CODE_OAUTH_TOKEN"] ?? "").trim();
  const model = env["HARTOS_COUNCIL_MODEL"]?.trim() || "sonnet";
  const timeoutMs = Number(env["HARTOS_COUNCIL_INFER_TIMEOUT_MS"]) || 120_000;
  const cap = Math.max(1, Number(env["HARTOS_COUNCIL_MAX_CONCURRENCY"]) || COUNCIL_CLAUDE_MAX_CONCURRENCY);
  const runner = opts?.runner ?? spawnCouncilClaudeRunner;

  // One semaphore per infer instance (so different cap values in tests are isolated).
  const sem = makeSemaphore(cap);

  return async (prompt: { system: string; user: string }): Promise<string> => {
    // Guard: no token → degrade immediately, never spawn.
    if (!token) return CLAUDE_INFER_SENTINEL;

    const combinedPrompt = `${prompt.system}\n\n${prompt.user}`;

    // Acquire a concurrency slot before spawning.
    const release = await sem.acquire();
    try {
      const result = await runner(combinedPrompt, { model, token, timeoutMs });
      if (result.ok && result.text.trim()) {
        return result.text;
      }
      return CLAUDE_INFER_SENTINEL;
    } catch {
      // Runner should never throw — but if it does, degrade honestly.
      return CLAUDE_INFER_SENTINEL;
    } finally {
      release();
    }
  };
}
