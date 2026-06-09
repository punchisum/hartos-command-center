/**
 * tests/cockpit-ask-host.test.ts — LLM Ask 2A (Node "Ask host").
 *
 * The Node/Edge Ask host (`scripts/cockpit-ask-host.ts`) injects an `AskInfer`
 * into the cockpit context so POST /api/ask can light up real LLM reasoning off
 * the Worker. These tests are HERMETIC — they inject a FAKE infer (no network,
 * no provider env) — and prove:
 *
 *   1. With an injected fake infer → the answer reports mode "llm", usedLlm true,
 *      grounded + propose-only.
 *   2. With NO infer (or a null-returning infer) → the answer is the deterministic
 *      grounding (mode "deterministic", usedLlm false) — the SAFE DEFAULT.
 *   3. No secret-looking value appears in the response.
 *
 * Harness mirrors tests/cloudflare-cockpit-ask.test.ts: a tmpdir-backed context
 * built via `buildAskHostContext`, driven through `handleCockpitRequest`.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleCockpitRequest } from "../src/runtime/cloudflare-cockpit-worker.js";
import { buildAskHostContext } from "../scripts/cockpit-ask-host.js";
import type { AskInfer } from "../src/llm/ask-llm.js";
import type { LlmResult } from "../src/llm/llm-types.js";

const base = "https://cockpit.local";

function post(request: string): Request {
  return new Request(`${base}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ request }),
  });
}

/** A fake infer returning a valid LlmResult (shape copied from ask-llm.test.ts). */
function fakeInfer(): { infer: AskInfer; calls: () => number } {
  let calls = 0;
  const infer: AskInfer = async (): Promise<LlmResult> => {
    calls += 1;
    return {
      output: {
        intent: "daily_brief",
        domain: "ops",
        confidence: "high",
        neededContext: ["live ops panel"],
        recommendedSpecialist: "ops_agent",
        riskLevel: "medium",
        nextAction: "review ops staleness",
        summary: "LLM reasoning: ops needs a refresh.",
      },
      provider: "openai",
      model: "gpt-test",
      mode: "openai",
      validation: "valid",
      success: true,
      requestType: "summarize_cockpit_state",
    };
  };
  return { infer, calls: () => calls };
}

describe("cockpit Ask host (LLM injection seam)", () => {
  let dir: string;
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ask-host-"));
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("buildAskHostContext sets askInfer (deterministic by default with no provider env)", async () => {
    // No provider env → the gateway behind buildAskInfer self-gates to deterministic.
    const ctx = await buildAskHostContext({}, { cwd: dir });
    assert.equal(typeof ctx.askInfer, "function", "the host wires an askInfer onto the context");
    const res = await handleCockpitRequest(post("What needs my attention today?"), {}, ctx);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { mode: string; provider: string; usedLlm: boolean; summary: string };
    // Safe default: even with askInfer wired, no provider env ⇒ deterministic grounding.
    assert.equal(data.mode, "deterministic");
    assert.equal(data.provider, "deterministic");
    assert.equal(data.usedLlm, false);
    assert.match(data.summary, /^Command Brief:/m, "summary is the unchanged deterministic grounding");
  });

  it("an INJECTED fake infer → mode 'llm', usedLlm true, propose-only, execution still disabled", async () => {
    const spy = fakeInfer();
    // The builder accepts a test-only infer override (no network, no provider env).
    const ctx = await buildAskHostContext({}, { cwd: dir, inferOverride: spy.infer });
    const res = await handleCockpitRequest(post("What needs my attention today?"), {}, ctx);
    assert.equal(res.status, 200);
    assert.equal(spy.calls(), 1, "the seam consults the injected infer");
    const data = (await res.json()) as {
      mode: string;
      provider: string;
      usedLlm: boolean;
      summary: string;
      riskLevel: string;
      actionExecution: string;
      mutationEndpoints: string;
    };
    assert.equal(data.mode, "llm");
    assert.equal(data.provider, "openai");
    assert.equal(data.usedLlm, true);
    assert.equal(data.summary, "LLM reasoning: ops needs a refresh.");
    assert.equal(data.riskLevel, "medium");
    // Doctrine floor unchanged on the LLM path: nothing becomes executable.
    assert.equal(data.actionExecution, "disabled");
    assert.equal(data.mutationEndpoints, "none");
  });

  it("setting ctx.askInfer directly on a built context also lights up the LLM path", async () => {
    // Proves the builder's result is plain/testable — callers may wire infer either way.
    const ctx = await buildAskHostContext({}, { cwd: dir });
    const spy = fakeInfer();
    ctx.askInfer = spy.infer;
    const res = await handleCockpitRequest(post("brief me"), {}, ctx);
    const data = (await res.json()) as { mode: string; usedLlm: boolean };
    assert.equal(spy.calls(), 1);
    assert.equal(data.mode, "llm");
    assert.equal(data.usedLlm, true);
  });

  it("a null-returning infer → honest deterministic fallback (safe default)", async () => {
    const nullInfer: AskInfer = async () => null;
    const ctx = await buildAskHostContext({}, { cwd: dir, inferOverride: nullInfer });
    const res = await handleCockpitRequest(post("What needs my attention today?"), {}, ctx);
    const data = (await res.json()) as { mode: string; usedLlm: boolean; summary: string };
    assert.equal(data.mode, "deterministic");
    assert.equal(data.usedLlm, false);
    assert.match(data.summary, /^Command Brief:/m);
  });

  it("explicitly clearing askInfer → deterministic answer (matches the Worker default)", async () => {
    const ctx = await buildAskHostContext({}, { cwd: dir });
    delete ctx.askInfer; // simulate the bare Worker context
    const res = await handleCockpitRequest(post("What needs my attention today?"), {}, ctx);
    const data = (await res.json()) as { mode: string; provider: string; usedLlm: boolean };
    assert.equal(data.mode, "deterministic");
    assert.equal(data.provider, "deterministic");
    assert.equal(data.usedLlm, false);
  });

  it("no secret-looking value appears in the /api/ask response", async () => {
    // Even though infer is faked, assert the response carries no token-shaped secret.
    const spy = fakeInfer();
    const ctx = await buildAskHostContext(
      { OPENAI_API_KEY: "sk-" + "a".repeat(40), HARTOS_COCKPIT_ACCESS_TOKEN: "tok-" + "b".repeat(40) },
      { cwd: dir, inferOverride: spy.infer }
    );
    const res = await handleCockpitRequest(post("What needs my attention today?"), {}, ctx);
    const text = await res.text();
    assert.ok(!text.includes("a".repeat(40)), "must not leak an OpenAI-key-shaped value");
    assert.ok(!text.includes("b".repeat(40)), "must not leak an access-token-shaped value");
    assert.ok(!/sk-[A-Za-z0-9_-]{16,}/.test(text), "no sk- token in the response");
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\./.test(text), "no JWT-shaped token in the response");
  });
});
