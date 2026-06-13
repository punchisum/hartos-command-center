/**
 * src/execution/claude-task-executor.ts — the Claude-CLI EXECUTION hand (Hart-approved tasks).
 *
 * Carries out an approved task by driving headless Claude Code (`claude -p`) on Hart's Max plan to
 * EDIT the repository — the "execute" half of `proposal → approve → execute` for Wolverine fixes,
 * agent-building, and other code changes. The same one gate as research (Hart's approval) authorizes
 * it; no second arming key per item.
 *
 * SAFETY (the seatbelt — these are NOT extra approval gates, they're the backstop):
 *   - ARM FLAG: runs only when HARTOS_ALLOW_CLAUDE_EXECUTE=true (default OFF ⇒ honest skip; the job
 *     stays approved + re-runnable). This is the master switch that turns the hands on at all.
 *   - KILL-SWITCH: HARTOS_EXECUTION_KILL_SWITCH=on hard-disables it (shared with every other executor).
 *   - TOOL SCOPE: Read/Edit/Write/Glob/Grep only — NO Bash, so it cannot run destructive or external
 *     commands; it can only edit files in the repo.
 *   - REVERSIBLE: every change lands in the git working tree → `git diff` to review, `git checkout`/
 *     `git stash` to undo. Nothing is committed or pushed by this executor.
 *   - AUDIT: the runner records executed/failed/skipped for every task (the caller's job).
 *   - AUTH: CLAUDE_CODE_OAUTH_TOKEN (Max plan); ANTHROPIC_API_KEY is stripped so it can't bill the API.
 *
 * Node host-edge only (spawns a process) — runs on the local daemon, never the Worker.
 */

import { spawn } from "node:child_process";
import { gateAgentBuild } from "./agent-build-gate.js";
import { assertCodeEditScope } from "./claude-exec-tool-scope.js";
import { captureBaseline, changedByRun, realGitProbe, type GitProbe } from "./claude-exec-baseline.js";

export const CLAUDE_EXECUTE_ARM_ENV = "HARTOS_ALLOW_CLAUDE_EXECUTE";
export const KILL_SWITCH_ENV = "HARTOS_EXECUTION_KILL_SWITCH";
const DEFAULT_MODEL = "sonnet";
const DEFAULT_TIMEOUT_MS = 600_000; // code tasks can take minutes
/** Code-editing tools only — deliberately NO Bash (no destructive/external commands). */
const EXEC_TOOLS = "Read,Edit,Write,Glob,Grep";

type Env = Record<string, string | undefined>;

export interface ClaudeTaskResult {
  ok: boolean;
  detail: string;
  /** W3 audit: the HEAD sha the run was anchored to (absent when skipped before baseline capture). */
  baselineSha?: string | null;
  /** W3 audit: working-tree files attributable to this run (empty array when the run wrote nothing). */
  filesChanged?: string[];
}

/** Run headless claude with edit tools; returns success + the model's summary text. Injectable for tests. */
export type ClaudeTaskRunner = (
  prompt: string,
  opts: { model: string; token: string; timeoutMs: number; cwd: string },
) => Promise<{ ok: boolean; text: string }>;

/** Is the Claude execution hand armed? Arm flag + kill-switch + token. Returns the honest reason. */
export function claudeExecuteArmed(env: Env): { armed: boolean; reason: string } {
  if ((env[KILL_SWITCH_ENV] ?? "").trim().toLowerCase() === "on") {
    return { armed: false, reason: "kill-switch ON (HARTOS_EXECUTION_KILL_SWITCH=on)" };
  }
  if ((env[CLAUDE_EXECUTE_ARM_ENV] ?? "").trim().toLowerCase() !== "true") {
    return { armed: false, reason: `disarmed (set ${CLAUDE_EXECUTE_ARM_ENV}=true to enable)` };
  }
  if (!(env["CLAUDE_CODE_OAUTH_TOKEN"] ?? "").trim()) {
    return { armed: false, reason: "no CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token`)" };
  }
  return { armed: true, reason: "armed" };
}

/** Default runner — spawns the real `claude` CLI with edit tools + acceptEdits (prompt via stdin). */
export const spawnClaudeTaskRunner: ClaudeTaskRunner = (prompt, { model, token, timeoutMs, cwd }) =>
  new Promise((resolve) => {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token };
    delete childEnv["ANTHROPIC_API_KEY"];
    delete childEnv["ANTHROPIC_AUTH_TOKEN"];
    const child = spawn(
      "claude",
      ["-p", "--model", model, "--allowedTools", EXEC_TOOLS, "--permission-mode", "acceptEdits", "--output-format", "json"],
      { env: childEnv, cwd, shell: process.platform === "win32" },
    );
    let out = "";
    let settled = false;
    const done = (v: { ok: boolean; text: string }) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => { child.kill(); done({ ok: false, text: "timeout" }); }, timeoutMs);
    child.stdout.on("data", (c) => (out += c.toString()));
    child.on("error", () => done({ ok: false, text: "spawn error" }));
    child.on("close", () => {
      try {
        const env = JSON.parse(out) as { is_error?: boolean; result?: unknown };
        done({ ok: env.is_error !== true, text: typeof env.result === "string" ? env.result : "" });
      } catch {
        done({ ok: false, text: out.slice(0, 200) });
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.write(prompt);
    child.stdin.end();
  });

const buildTaskPrompt = (task: string): string =>
  `You are HartOS's execution agent applying a Hart-APPROVED change to THIS repository (the current ` +
  `working directory). Carry out exactly the task below by reading and editing files. Keep the change ` +
  `minimal, correct, and consistent with the surrounding code and conventions. Do not delete unrelated ` +
  `code. When finished, reply with a one-paragraph summary of exactly which files you changed and why.\n\n` +
  `APPROVED TASK:\n${task}`;

/**
 * Execute one approved task via headless Claude. Honest skip (ok:false) when disarmed/kill-switched/
 * no token — the runner keeps the job approved + re-runnable. Never throws.
 */
export async function runClaudeTask(
  task: string,
  env: Env = process.env,
  runner: ClaudeTaskRunner = spawnClaudeTaskRunner,
  git: GitProbe = realGitProbe,
): Promise<ClaudeTaskResult> {
  const gate = claudeExecuteArmed(env);
  if (!gate.armed) return { ok: false, detail: `skipped — ${gate.reason}` };
  if (!task || !task.trim()) return { ok: false, detail: "skipped — empty task" };

  // SPEC-INTERROGATION GATE: HartOS must grill for specs before building an agent.
  const buildGate = gateAgentBuild(task);
  if (!buildGate.allowed) {
    return {
      ok: false,
      detail: `refused — ${buildGate.reason} Required specs: ${buildGate.questions.slice(0, 6).join(" · ") || "(see Factory)"}`,
    };
  }

  // W3: the tool scope handed to the hand must be code-edit-only — asserted, not assumed.
  const scope = assertCodeEditScope(EXEC_TOOLS);
  if (!scope.safe) {
    return { ok: false, detail: `refused — unsafe tool scope: ${scope.reason}`, baselineSha: null };
  }

  // W3: anchor the run to a git baseline. An unauditable run (no git) must NOT proceed.
  const cwd = process.cwd();
  let baseline;
  try {
    baseline = captureBaseline(cwd, git);
  } catch (e) {
    return { ok: false, detail: `skipped — cannot capture git baseline: ${e instanceof Error ? e.message : String(e)}`, baselineSha: null };
  }

  const model = env["HARTOS_CLAUDE_EXECUTE_MODEL"]?.trim() || DEFAULT_MODEL;
  const timeoutMs = Number(env["HARTOS_CLAUDE_EXECUTE_TIMEOUT_MS"]) || DEFAULT_TIMEOUT_MS;
  const token = (env["CLAUDE_CODE_OAUTH_TOKEN"] ?? "").trim();
  try {
    const r = await runner(buildTaskPrompt(task), { model, token, timeoutMs, cwd });
    if (!r.ok) {
      return { ok: false, detail: `claude execution failed: ${r.text.replace(/\s+/g, " ").slice(0, 200)}`, baselineSha: baseline.headSha, filesChanged: [] };
    }
    const filesChanged = changedByRun(cwd, baseline, git);
    return {
      ok: true,
      detail: `claude applied (${filesChanged.length} file(s); review the working tree): ${r.text.replace(/\s+/g, " ").slice(0, 240)}`,
      baselineSha: baseline.headSha,
      filesChanged,
    };
  } catch (e) {
    return { ok: false, detail: `claude execution threw: ${e instanceof Error ? e.message : String(e)}`, baselineSha: baseline.headSha, filesChanged: [] };
  }
}
