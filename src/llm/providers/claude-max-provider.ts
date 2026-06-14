/**
 * src/llm/providers/claude-max-provider.ts
 *
 * HOST-ONLY Claude-on-Max LLM provider for the HartOS gateway.
 *
 * Spawns `claude -p --output-format json --model <model>` (headless, no tools,
 * pure reasoning) using the standard 8-field structured output contract so the
 * central gateway validator (validateLlmOutput) accepts the result identically
 * to Gemini / OpenAI outputs.
 *
 * Auth: CLAUDE_CODE_OAUTH_TOKEN from config.claudeMaxToken or process.env.
 *       ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are STRIPPED from the child env
 *       so the Max-plan OAuth is used exclusively — never a pay-as-you-go key.
 *
 * On any error (no token / is_error / bad JSON / timeout / spawn failure) this
 * provider THROWS so the gateway falls through to the next provider in the chain
 * (gemini → deterministic). Never crashes the process.
 *
 * Concurrency: a module-level semaphore caps simultaneous spawns.
 * Cap = HARTOS_LLM_MAX_CONCURRENCY (default 3). Each provider instance gets its
 * own semaphore so tests with different caps stay isolated.
 *
 * IMPORTANT — NODE HOST ONLY:
 *   This file imports node:child_process. It MUST NEVER appear in the Cloudflare
 *   Worker's import graph. Use host-gateway.ts (also HOST-ONLY) to wire it up;
 *   run-ask-llm.ts and cloudflare-cockpit-worker.ts must never import this file.
 *
 * Injectable spawn runner:
 *   The real provider exports `claudeMaxProvider` (uses the real spawn). Tests
 *   call `buildClaudeMaxProvider(fakeRunner)` to get a hermetically isolated
 *   instance with no real child process.
 */

import { spawn } from "node:child_process";
import type { LlmGatewayConfig, LlmProvider, LlmRequest } from "../llm-types.js";
import { buildSystemPrompt, buildUserPrompt } from "../prompt-contracts.js";

// ── Default constants ─────────────────────────────────────────────────────────

/** Default Claude model passed to `--model`. Override with HARTOS_CLAUDE_MAX_MODEL (a CLAUDE model). */
export const CLAUDE_MAX_DEFAULT_MODEL = "sonnet";

/** Default timeout (ms) before the child is killed and the provider throws. */
export const CLAUDE_MAX_DEFAULT_TIMEOUT_MS = 120_000;

/** Default max simultaneous claude spawns per provider instance. */
export const CLAUDE_MAX_DEFAULT_CONCURRENCY = 3;

// ── Semaphore ────────────────────────────────────────────────────────────────

type Release = () => void;

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

// ── Injectable spawn seam ────────────────────────────────────────────────────

/**
 * The injectable spawn runner. The default uses node:child_process.spawn; tests
 * inject a fake so no real child process is ever created in CI.
 */
export type ClaudeMaxRunner = (
  prompt: string,
  opts: { model: string; token: string; timeoutMs: number },
) => Promise<{ ok: boolean; text: string }>;

/** Read the OAuth token at call time — never stored, never logged. */
function readToken(config?: LlmGatewayConfig): string | undefined {
  // LlmGatewayConfig doesn't carry the token — it lives in env only (never on
  // the public config object). We read process.env at call time, mirroring the
  // way the council infer path works (host-only, never in the Worker).
  const fromEnv = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
  return typeof fromEnv === "string" && fromEnv.trim().length > 0 ? fromEnv.trim() : undefined;
}

/** The real spawn runner — shells out to the `claude` CLI. */
export const spawnClaudeMaxRunner: ClaudeMaxRunner = (prompt, { model, token, timeoutMs }) =>
  new Promise((resolve) => {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token };
    delete childEnv["ANTHROPIC_API_KEY"];
    delete childEnv["ANTHROPIC_AUTH_TOKEN"];

    const child = spawn(
      "claude",
      // Pure reasoning, no tools granted. We do NOT pass `--allowedTools ""`: an empty-string arg is
      // DROPPED by cmd.exe under `shell:true` on Windows, which makes claude exit with "argument
      // missing". Headless `-p` with the default permission-mode grants no tool execution anyway.
      ["-p", "--output-format", "json", "--model", model],
      { env: childEnv, shell: process.platform === "win32" },
    );

    let out = "";
    let settled = false;
    const done = (v: { ok: boolean; text: string }) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(v);
      }
    };

    const timer = setTimeout(() => {
      child.kill();
      done({ ok: false, text: "timeout" });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => (out += chunk.toString()));
    child.on("error", () => done({ ok: false, text: "spawn error" }));
    child.on("close", () => {
      try {
        const envelope = JSON.parse(out) as { is_error?: boolean; result?: unknown };
        const ok =
          envelope.is_error !== true &&
          typeof envelope.result === "string" &&
          envelope.result.length > 0;
        done({ ok, text: ok ? (envelope.result as string) : out.slice(0, 200) });
      } catch {
        done({ ok: false, text: out.slice(0, 200) });
      }
    });

    child.stdin.on("error", () => {}); // ignore EPIPE if child exits early
    child.stdin.write(prompt);
    child.stdin.end();
  });

// ── Provider factory ─────────────────────────────────────────────────────────

/**
 * Build a claude-max LlmProvider with the given runner and concurrency cap.
 * Exported for tests — pass a fake runner to avoid real spawns.
 */
export function buildClaudeMaxProvider(
  runner: ClaudeMaxRunner = spawnClaudeMaxRunner,
  opts: {
    concurrencyCap?: number;
    timeoutMs?: number;
  } = {},
): LlmProvider {
  const cap = Math.max(1, opts.concurrencyCap ?? CLAUDE_MAX_DEFAULT_CONCURRENCY);
  const timeoutMs = opts.timeoutMs ?? CLAUDE_MAX_DEFAULT_TIMEOUT_MS;
  const sem = makeSemaphore(cap);

  return {
    name: "claude-max",
    async generate(req: LlmRequest, config: LlmGatewayConfig): Promise<unknown> {
      const token = readToken(config);
      if (!token) {
        throw new Error("claude-max: CLAUDE_CODE_OAUTH_TOKEN is not set.");
      }

      // A CLAUDE model only. NOT HARTOS_LLM_MODEL — that names the Gemini/OpenAI gateway model
      // (e.g. "gpt-5.5"), which `claude --model` rejects → the provider would throw → silent Gemini
      // fallback. Use the council's claude-model var (or a dedicated one), defaulting to "sonnet".
      const model =
        (process.env["HARTOS_CLAUDE_MAX_MODEL"] ?? process.env["HARTOS_COUNCIL_MODEL"] ?? CLAUDE_MAX_DEFAULT_MODEL).trim() ||
        CLAUDE_MAX_DEFAULT_MODEL;

      // Build the combined prompt: system contract + user request (8-field contract).
      const prompt = `${buildSystemPrompt(req.type)}\n\n${buildUserPrompt(req)}`;

      // Acquire a concurrency slot before spawning.
      const release = await sem.acquire();
      try {
        const result = await runner(prompt, { model, token, timeoutMs });
        if (!result.ok || !result.text.trim()) {
          throw new Error(`claude-max: spawn returned failure. text=${result.text.slice(0, 100)}`);
        }
        // Parse the model's result text as JSON. The gateway validates the 8-field shape.
        try {
          return JSON.parse(result.text);
        } catch {
          throw new Error("claude-max: result text was not valid JSON.");
        }
      } finally {
        release();
      }
    },
  };
}

/**
 * The default claude-max provider (uses the real spawn runner). Import this
 * in HOST-ONLY code (e.g. host-gateway.ts). Never import in the Worker.
 */
export const claudeMaxProvider: LlmProvider = buildClaudeMaxProvider();
