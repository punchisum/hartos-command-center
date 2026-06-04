/**
 * tests/openai-adapter.test.ts
 *
 * Tests for the Phase 7A real OpenAI verification adapter.
 * All OpenAI API calls are mocked via injected fetch.
 * No real API calls are performed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { OpenAIAdapter } from "../src/provisioning/adapters/openai.js";
import type { ProvisionContext } from "../src/provisioning/types.js";

// ─── Mock helpers ────────────────────────────────────────────────────────────

function makeFetch(status: number, body: unknown): typeof fetch {
  return async (): Promise<Response> =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

function makeCtx(env: Record<string, string> = {}): ProvisionContext {
  return { agentName: "test-agent", environment: "local", env };
}

// ─── Missing env ─────────────────────────────────────────────────────────────

describe("OpenAI adapter — missing env", () => {
  test("missing OPENAI_API_KEY → missing_env", async () => {
    const adapter = new OpenAIAdapter();
    const ctx = makeCtx({});
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "missing_env");
    assert.ok(vr.missingEnv.includes("OPENAI_API_KEY"));
  });

  test("missing key returns helpful nextAction", async () => {
    const adapter = new OpenAIAdapter();
    const ctx = makeCtx({});
    const vr = await adapter.verify(ctx);
    assert.ok(vr.nextAction.includes("OPENAI_API_KEY"));
  });
});

// ─── Gate not open ───────────────────────────────────────────────────────────

describe("OpenAI adapter — gate not open", () => {
  test("key present but gate not open → configured without API call", async () => {
    let fetchCalled = false;
    const mockFetch: typeof fetch = async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    };
    const adapter = new OpenAIAdapter(mockFetch);
    const ctx = makeCtx({ OPENAI_API_KEY: "test-key" });
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "configured");
    assert.equal(fetchCalled, false, "API must not be called when gate is closed");
  });

  test("gate not open → nextAction mentions ALLOW_OPENAI_VERIFY", async () => {
    const adapter = new OpenAIAdapter();
    const ctx = makeCtx({ OPENAI_API_KEY: "test-key" });
    const vr = await adapter.verify(ctx);
    assert.ok(vr.nextAction.includes("ALLOW_OPENAI_VERIFY"));
  });
});

// ─── API success ─────────────────────────────────────────────────────────────

describe("OpenAI adapter — API success", () => {
  test("successful model check → configured", async () => {
    const adapter = new OpenAIAdapter(makeFetch(200, { id: "gpt-4o", object: "model" }));
    const ctx = makeCtx({
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "gpt-4o",
      ALLOW_OPENAI_VERIFY: "true",
    });
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "configured");
    assert.ok(vr.safeSummary.includes("gpt-4o") || vr.safeSummary.includes("accessible"));
  });

  test("API success uses OPENAI_MODEL from env", async () => {
    let capturedUrl = "";
    const mockFetch: typeof fetch = async (input) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify({ id: "gpt-3.5-turbo" }), { status: 200 });
    };
    const adapter = new OpenAIAdapter(mockFetch);
    const ctx = makeCtx({
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "gpt-3.5-turbo",
      ALLOW_OPENAI_VERIFY: "true",
    });
    await adapter.verify(ctx);
    assert.ok(capturedUrl.includes("gpt-3.5-turbo"), "URL should include the configured model");
  });
});

// ─── API failure ─────────────────────────────────────────────────────────────

describe("OpenAI adapter — API failure", () => {
  test("401 → error status with safe message", async () => {
    const adapter = new OpenAIAdapter(makeFetch(401, { error: { message: "Invalid API key" } }));
    const ctx = makeCtx({
      OPENAI_API_KEY: "test-key",
      ALLOW_OPENAI_VERIFY: "true",
    });
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "error");
    assert.ok(vr.safeSummary.includes("401") || vr.safeSummary.includes("invalid") || vr.safeSummary.includes("rejected"));
  });

  test("404 → error with model not found message", async () => {
    const adapter = new OpenAIAdapter(makeFetch(404, { error: { message: "Model not found" } }));
    const ctx = makeCtx({
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "gpt-nonexistent",
      ALLOW_OPENAI_VERIFY: "true",
    });
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "error");
    assert.ok(vr.nextAction.includes("OPENAI_MODEL") || vr.safeSummary.includes("not found"));
  });

  test("network error → error with safe message", async () => {
    const mockFetch: typeof fetch = async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:443");
    };
    const adapter = new OpenAIAdapter(mockFetch);
    const ctx = makeCtx({
      OPENAI_API_KEY: "test-key",
      ALLOW_OPENAI_VERIFY: "true",
    });
    const vr = await adapter.verify(ctx);
    assert.equal(vr.status, "error");
    assert.ok(vr.safeSummary.includes("error") || vr.safeSummary.includes("network"));
  });
});

// ─── Key never in output ──────────────────────────────────────────────────────

describe("OpenAI adapter — key never in output", () => {
  test("verify() safeSummary never includes API key value", async () => {
    const adapter = new OpenAIAdapter(makeFetch(200, { id: "gpt-4o" }));
    const ctx = makeCtx({
      OPENAI_API_KEY: "secret-key-value",
      ALLOW_OPENAI_VERIFY: "true",
    });
    const vr = await adapter.verify(ctx);
    assert.ok(!vr.safeSummary.includes("secret-key-value"), "safeSummary must not contain API key");
    assert.ok(!vr.nextAction.includes("secret-key-value"), "nextAction must not contain API key");
  });

  test("verify() never sends key in URL", async () => {
    let capturedUrl = "";
    const mockFetch: typeof fetch = async (input) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify({}), { status: 200 });
    };
    const adapter = new OpenAIAdapter(mockFetch);
    const ctx = makeCtx({
      OPENAI_API_KEY: "test-api-key-secret",
      ALLOW_OPENAI_VERIFY: "true",
    });
    await adapter.verify(ctx);
    assert.ok(!capturedUrl.includes("test-api-key-secret"), "URL must not contain API key");
  });

  test("error status safeSummary does not contain key", async () => {
    const adapter = new OpenAIAdapter(makeFetch(401, {}));
    const ctx = makeCtx({
      OPENAI_API_KEY: "my-secret-key",
      ALLOW_OPENAI_VERIFY: "true",
    });
    const vr = await adapter.verify(ctx);
    assert.ok(!vr.safeSummary.includes("my-secret-key"), "error summary must not contain key");
  });

  test("request does not include key in body or URL", async () => {
    let capturedBody = "";
    const mockFetch: typeof fetch = async (input, init) => {
      capturedBody = (init?.body as string) ?? "";
      return new Response(JSON.stringify({ id: "gpt-4o" }), { status: 200 });
    };
    const adapter = new OpenAIAdapter(mockFetch);
    const ctx = makeCtx({
      OPENAI_API_KEY: "ultra-secret-key",
      ALLOW_OPENAI_VERIFY: "true",
    });
    await adapter.verify(ctx);
    assert.ok(!capturedBody.includes("ultra-secret-key"), "Request body must not contain API key");
  });
});

// ─── plan() ───────────────────────────────────────────────────────────────────

describe("OpenAI adapter — plan()", () => {
  test("returns verify_model step", async () => {
    const adapter = new OpenAIAdapter();
    const ctx = makeCtx({});
    const steps = await adapter.plan(ctx);
    assert.equal(steps.length, 1);
    assert.equal(steps[0]!.action, "verify_model");
  });

  test("verify_model step is read-only (not mutating)", async () => {
    const adapter = new OpenAIAdapter();
    const ctx = makeCtx({});
    const steps = await adapter.plan(ctx);
    assert.equal(steps[0]!.mutation, false);
  });

  test("verify_model has ALLOW_OPENAI_VERIFY gate", async () => {
    const adapter = new OpenAIAdapter();
    const ctx = makeCtx({});
    const steps = await adapter.plan(ctx);
    assert.equal(steps[0]!.requiredGate, "ALLOW_OPENAI_VERIFY");
  });
});
