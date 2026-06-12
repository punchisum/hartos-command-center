/**
 * src/research/research-claude.ts — research via headless Claude Code on the Max subscription.
 *
 * Shells out to `claude -p … --output-format json` with WebSearch/WebFetch allowed, authenticated by
 * CLAUDE_CODE_OAUTH_TOKEN (Hart's Max plan's Agent-SDK credit pool — NOT pay-per-token API credits).
 * Each sub-question becomes one grounded Claude research turn; the answer + its source URLs become
 * GatheredSource[]. Node host-edge only (spawns a process) — runs on the local daemon, never the Worker.
 *
 * Auth: the call's env carries CLAUDE_CODE_OAUTH_TOKEN and DROPS ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN
 * so it can't fall through to API billing. A standard model is pinned (the 1M-context model needs paid
 * usage credits). A miss/error yields ZERO sources (honest "unknown" — never fabricated).
 */

import { spawn } from "node:child_process";
import { resolveLlmConfig } from "../llm/llm-gateway.js";
import type { SourceFetcher } from "./research-gatherer.js";
import type { GatheredSource } from "./research-synthesis.js";

type Env = Record<string, string | undefined>;

export const DEFAULT_CLAUDE_RESEARCH_MODEL = "sonnet";
const DEFAULT_TIMEOUT_MS = 180_000;

export interface ClaudeResearchResult {
  answer: string;
  sources: { url: string; title: string }[];
}
export type ClaudeResearchInfer = (subQuestion: string, topic: string) => Promise<ClaudeResearchResult | null>;

/** Run `claude -p` headless and return the model's `result` text, or null on any failure. Injectable. */
export type ClaudeRunner = (prompt: string, opts: { model: string; token: string; timeoutMs: number }) => Promise<string | null>;

const buildPrompt = (subQuestion: string, topic: string): string =>
  `Research this question using WebSearch (and WebFetch when useful). Be specific and source-grounded; ` +
  `never invent sources or facts. Topic: ${topic}\nQuestion: ${subQuestion}\n\n` +
  `Reply with ONLY a JSON object (no prose, no code fences): ` +
  `{"answer": "<thorough grounded answer>", "sources": [{"title": "<title>", "url": "<url>"}]}. ` +
  `If you could not find sources, return an empty sources array and say so in answer.`;

/**
 * Default runner: spawns the real `claude` CLI. The PROMPT is piped via STDIN (not argv) so a long
 * multi-line prompt with quotes can't be mangled by the Windows shell; only simple flags ride in
 * argv, and tools are comma-joined (a space-separated value would be split by shell:true). `-p` with
 * no positional prompt makes Claude read the prompt from stdin.
 */
export const spawnClaudeRunner: ClaudeRunner = (prompt, { model, token, timeoutMs }) =>
  new Promise((resolve) => {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token };
    delete childEnv["ANTHROPIC_API_KEY"];
    delete childEnv["ANTHROPIC_AUTH_TOKEN"];
    const child = spawn(
      "claude",
      ["-p", "--model", model, "--allowedTools", "WebSearch,WebFetch", "--output-format", "json"],
      { env: childEnv, shell: process.platform === "win32" },
    );
    let out = "";
    let settled = false;
    const done = (v: string | null) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => { child.kill(); done(null); }, timeoutMs);
    child.stdout.on("data", (c) => (out += c.toString()));
    child.on("error", () => done(null));
    child.on("close", () => {
      try {
        const env = JSON.parse(out) as { is_error?: boolean; result?: unknown };
        if (env.is_error === true || typeof env.result !== "string") return done(null);
        done(env.result);
      } catch {
        done(null);
      }
    });
    child.stdin.on("error", () => {}); // ignore EPIPE if the child exits early
    child.stdin.write(prompt);
    child.stdin.end();
  });

/** Strip ```json fences and parse the model's structured answer. */
export function parseClaudeResearch(resultText: string): ClaudeResearchResult | null {
  const cleaned = resultText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const answer = typeof (obj as { answer?: unknown }).answer === "string" ? (obj as { answer: string }).answer : "";
  if (!answer) return null;
  const rawSources = Array.isArray((obj as { sources?: unknown }).sources) ? (obj as { sources: unknown[] }).sources : [];
  const sources: { url: string; title: string }[] = [];
  for (const s of rawSources) {
    const url = typeof (s as { url?: unknown })?.url === "string" ? (s as { url: string }).url : "";
    const title = typeof (s as { title?: unknown })?.title === "string" ? (s as { title: string }).title : "";
    if (url) sources.push({ url, title: title || url });
  }
  return { answer, sources };
}

/** Gated infer fn. Returns null unless CLAUDE_CODE_OAUTH_TOKEN is present + the runner succeeds. */
export function buildClaudeResearchInfer(env: Env = process.env, runner: ClaudeRunner = spawnClaudeRunner): ClaudeResearchInfer {
  resolveLlmConfig(env); // (kept for parity / future provider checks)
  const token = (env["CLAUDE_CODE_OAUTH_TOKEN"] ?? "").trim();
  const model = env["HARTOS_RESEARCH_CLAUDE_MODEL"]?.trim() || DEFAULT_CLAUDE_RESEARCH_MODEL;
  const timeoutMs = Number(env["HARTOS_RESEARCH_CLAUDE_TIMEOUT_MS"]) || DEFAULT_TIMEOUT_MS;
  return async (subQuestion, topic) => {
    if (!token) return null;
    const resultText = await runner(buildPrompt(subQuestion, topic), { model, token, timeoutMs });
    if (resultText === null) return null;
    return parseClaudeResearch(resultText);
  };
}

export interface BuildClaudeFetcherOptions {
  topic: string;
  now: string;
  env?: Env;
  infer?: ClaudeResearchInfer;
}

/** A SourceFetcher backed by headless Claude on Max — drop-in for the web/gemini fetchers. */
export function buildClaudeSourceFetcher(opts: BuildClaudeFetcherOptions): SourceFetcher {
  const infer = opts.infer ?? buildClaudeResearchInfer(opts.env);
  return async (subQuestion, index) => {
    const r = await infer(subQuestion, opts.topic);
    if (!r) return [];
    if (r.sources.length === 0) {
      return [
        {
          ref: `claude:max:uncited`,
          title: `Claude (Max) grounded answer — no source URLs returned`,
          content: r.answer,
          answers: [index],
          asOf: opts.now,
        },
      ];
    }
    return r.sources.map((c): GatheredSource => ({
      ref: c.url,
      title: c.title,
      content: r.answer,
      answers: [index],
      asOf: opts.now,
    }));
  };
}
