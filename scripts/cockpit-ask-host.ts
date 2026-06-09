/**
 * scripts/cockpit-ask-host.ts
 *
 * cockpit:ask-host — the Node/Edge "Ask host" that INJECTS the LLM into the
 * cockpit. It serves exactly the Cloudflare Worker handler (handleCockpitRequest)
 * but sets `ctx.askInfer = buildAskInfer(...)` so POST /api/ask can light up REAL,
 * redaction-first, validated, propose-only LLM reasoning.
 *
 *   npm run cockpit:ask-host            → start a local server (default :8789)
 *   npm run cockpit:ask-host -- --smoke → run probes through the handler, no server
 *
 * WHY A SEPARATE NODE ENTRY (and never the Worker bundle):
 *   The gateway behind `buildAskInfer` (src/llm/run-ask-llm.ts → llm-gateway.ts)
 *   imports node:path, so it is Node/Edge-only and Worker-UNSAFE. The cockpit
 *   handler stays Worker-safe by taking the inference INJECTED via ctx.askInfer
 *   (unset on the Worker ⇒ deterministic). This host is the plane allowed to wire
 *   the gateway in. It MUST NEVER be imported by the Worker bundle.
 *
 * SAFE-BY-DEFAULT (doctrine):
 *   The gateway SELF-GATES: a real OpenAI call happens only when
 *   HARTOS_LLM_PROVIDER=openai AND HARTOS_LLM_ENABLE_NETWORK=true AND
 *   OPENAI_API_KEY is present. With no provider env, `buildAskInfer` yields the
 *   deterministic provider, so the answer is identical to the Worker default.
 *   We do not bypass that gate. The LLM may reason/propose, NEVER execute/approve
 *   (the orchestrator already enforces `proposeOnly`). No secret value is ever
 *   logged — env presence is reported by NAME only.
 */

import http from "node:http";
import { pathToFileURL } from "node:url";
import { handleCockpitRequest, createCockpitWorkerContext } from "../src/runtime/cloudflare-cockpit-worker.js";
import type { CloudflareCockpitEnv, CockpitWorkerContext } from "../src/runtime/cloudflare-cockpit-types.js";
import { buildAskInfer } from "../src/llm/run-ask-llm.js";
import type { AskInfer } from "../src/llm/ask-llm.js";

/**
 * The LLM-gating env names this host reads (presence only — values are NEVER
 * logged or returned). Kept here so the startup banner can report which gates
 * are armed without ever touching the secret.
 */
const LLM_GATE_ENV_NAMES = [
  "HARTOS_LLM_PROVIDER",
  "HARTOS_LLM_ENABLE_NETWORK",
  "OPENAI_API_KEY",
  "HARTOS_LLM_MODEL",
] as const;

export interface AskHostOptions {
  /** Working dir for the base cockpit context (read model snapshot). Defaults to process.cwd(). */
  cwd?: string;
  /**
   * TEST-ONLY override: inject a fake `AskInfer` instead of the real gated gateway.
   * Production code leaves this unset so the self-gating `buildAskInfer` is used.
   */
  inferOverride?: AskInfer;
}

/**
 * Wire the gateway behind an explicit gate. When the LLM gate is OPEN
 * (provider=openai + network=true + key) return the real self-gating
 * `buildAskInfer`. Otherwise return an infer that yields `null`, so
 * `composeAskAnswer` keeps the honest deterministic GROUNDING (mode
 * 'deterministic') — identical to the safe Worker default, and RICHER than the
 * gateway's own generic deterministic output (which it would mislabel 'llm').
 * Either way an `askInfer` function IS wired — the host always exposes the seam;
 * only the gate decides whether it reaches a real provider. The gateway remains
 * the single source of truth for the gate; `llmArmed` only mirrors it.
 */
function gatedAskInfer(env: CloudflareCockpitEnv): AskInfer {
  if (!llmArmed(env)) return async () => null;
  return buildAskInfer({ env });
}

/**
 * Build the cockpit Worker context with the LLM seam wired.
 *
 * It builds the base context via the SAME path the existing Node entries use
 * (`createCockpitWorkerContext`), then sets `ctx.askInfer`:
 *   - production: `gatedAskInfer(env)` — a real provider ONLY when the gateway's
 *     gate is open; otherwise a null-yielding infer ⇒ the honest deterministic
 *     grounding (mode 'deterministic'), matching the safe Worker default.
 *   - tests: an injected `inferOverride` (a fake infer; NO network) always wins.
 *
 * The returned context is plain/testable: callers may also set or clear
 * `ctx.askInfer` directly on the result.
 */
export async function buildAskHostContext(
  env: CloudflareCockpitEnv,
  opts: AskHostOptions = {}
): Promise<CockpitWorkerContext> {
  const ctx = await createCockpitWorkerContext({ ...(opts.cwd ? { cwd: opts.cwd } : {}) });
  ctx.askInfer = opts.inferOverride ?? gatedAskInfer(env);
  return ctx;
}

/** Names of the LLM gate env vars that are PRESENT (never their values). */
function presentLlmGateNames(env: CloudflareCockpitEnv): string[] {
  return LLM_GATE_ENV_NAMES.filter((name) => {
    const v = env[name];
    return typeof v === "string" && v.trim().length > 0;
  });
}

/**
 * Whether the gateway's gate would arm a REAL provider call. Mirrors the
 * gateway's own rule (provider=openai AND network=true AND key present). Used
 * for the honest startup banner only — the gateway remains the single gate.
 */
function llmArmed(env: CloudflareCockpitEnv): boolean {
  return (
    (env["HARTOS_LLM_PROVIDER"] ?? "").toLowerCase() === "openai" &&
    env["HARTOS_LLM_ENABLE_NETWORK"] === "true" &&
    typeof env["OPENAI_API_KEY"] === "string" &&
    env["OPENAI_API_KEY"]!.trim().length > 0
  );
}

const PROBES: Array<{ label: string; path: string; method?: string; body?: unknown; expect: number }> = [
  { label: "GET /health", path: "/health", expect: 200 },
  {
    label: "POST /api/ask (daily brief, LLM seam armed)",
    path: "/api/ask",
    method: "POST",
    body: { request: "What needs my attention today?" },
    expect: 200,
  },
  { label: "DELETE / (rejected)", path: "/", method: "DELETE", expect: 405 },
];

async function runSmoke(env: CloudflareCockpitEnv, ctx: CockpitWorkerContext, base: string): Promise<boolean> {
  console.log("\nHartOS Hosted Cockpit — cockpit:ask-host smoke (handler only, no server)\n");
  let ok = true;
  for (const p of PROBES) {
    const init: RequestInit = { method: p.method ?? "GET" };
    if (p.body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(p.body);
    }
    const res = await handleCockpitRequest(new Request(`${base}${p.path}`, init), env, ctx);
    const pass = res.status === p.expect;
    if (!pass) ok = false;
    let extra = "";
    if (p.path === "/api/ask" && res.status === 200) {
      const body = await res.clone().text();
      // Belt-and-braces: the orchestrator already redacts, but never let a
      // secret-shaped token through a smoke response.
      const hasSecret = /sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\./.test(body);
      const data = JSON.parse(body) as { mode?: string; provider?: string; usedLlm?: boolean };
      extra = ` [mode=${data.mode}, provider=${data.provider}, usedLlm=${data.usedLlm}, secrets=${hasSecret ? "LEAK!" : "none"}]`;
      if (hasSecret) ok = false;
    }
    console.log(`  ${pass ? "ok  " : "FAIL"} ${p.label} → ${res.status} (expect ${p.expect})${extra}`);
  }
  console.log("");
  if (!ok) {
    console.log("Smoke had failures.\n");
    return false;
  }
  console.log("Smoke passed — Ask host serves read-only, propose-only, secret-free.\n");
  return true;
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function startServer(env: CloudflareCockpitEnv, ctx: CockpitWorkerContext, port: number): void {
  const server = http.createServer(async (req, res) => {
    try {
      const url = `http://localhost:${port}${req.url ?? "/"}`;
      const method = (req.method ?? "GET").toUpperCase();
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(", "));
      }
      const init: RequestInit = { method, headers };
      if (method === "POST") init.body = await readBody(req);
      const response = await handleCockpitRequest(new Request(url, init), env, ctx);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      const buf = Buffer.from(await response.arrayBuffer());
      res.end(buf);
    } catch (err) {
      res.statusCode = 500;
      res.end(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  server.listen(port, () => {
    console.log(`\nHartOS Hosted Cockpit — Ask host (LLM injected) on http://localhost:${port}`);
    console.log(`  Ask endpoint : POST http://localhost:${port}/api/ask`);
    console.log(`  LLM gates present (names only): ${presentLlmGateNames(env).join(", ") || "(none)"}`);
    console.log(`  LLM provider armed: ${llmArmed(env) ? "yes (OpenAI gate open)" : "no (deterministic — safe default)"}`);
    console.log(`  Read-only · propose-only · no mutation · no secrets in logs · Ctrl+C to stop\n`);
  });
}

/**
 * The runnable bin. Guarded so importing this module (e.g. from the test) does
 * NOT start a server — only direct execution does.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const smoke = args.includes("--smoke");
  const port = Number(process.env.PORT ?? 8789);
  const cwd = process.cwd();

  // Inherit the real environment so the gateway can resolve its own gate. Auth
  // is bypassed locally (dev only) so the Ask endpoint is directly exercisable.
  const env: CloudflareCockpitEnv = {
    ...process.env,
    APP_ENV: process.env.APP_ENV ?? "development",
    HARTOS_COCKPIT_DEV_AUTH_BYPASS: "true",
  };

  const ctx = await buildAskHostContext(env, { cwd });

  if (smoke) {
    const ok = await runSmoke(env, ctx, "https://cockpit.local");
    if (!ok) process.exitCode = 1;
  } else {
    startServer(env, ctx, port);
  }
}

// Direct-run guard (NodeNext ESM): run main() only when this file is the entry,
// never when imported (the test imports buildAskHostContext). pathToFileURL
// normalizes the Windows drive-letter/path form so the comparison is robust.
const invokedDirectly =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
