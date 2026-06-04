/**
 * tests/observability-check.test.ts
 *
 * Tests for the Supabase debug_events observability check.
 * All Supabase calls are mocked. No real API calls.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkObservability } from "../src/launch/observability-check.js";

function makeFetch(status: number, body: unknown): typeof fetch {
  return async (): Promise<Response> =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

describe("checkObservability — missing env", () => {
  test("missing SUPABASE_URL → missing_env", async () => {
    const result = await checkObservability({ SUPABASE_SERVICE_ROLE_KEY: "key" });
    assert.equal(result.status, "missing_env");
    assert.equal(result.recentEvents, 0);
  });

  test("missing SUPABASE_SERVICE_ROLE_KEY → missing_env", async () => {
    const result = await checkObservability({ SUPABASE_URL: "https://example.supabase.co" });
    assert.equal(result.status, "missing_env");
  });

  test("both missing → missing_env with helpful message", async () => {
    const result = await checkObservability({});
    assert.equal(result.status, "missing_env");
    assert.ok(result.nextAction.includes("SUPABASE_URL"));
  });
});

describe("checkObservability — mock Supabase responses", () => {
  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  };

  test("200 with events → ok status", async () => {
    const events = [{ outcome: "ok" }, { outcome: "ok" }, { outcome: "ok" }];
    const result = await checkObservability(env, makeFetch(200, events));
    assert.equal(result.status, "ok");
    assert.equal(result.recentEvents, 3);
    assert.equal(result.errorRate, 0);
  });

  test("200 with high error rate → degraded", async () => {
    const events = [
      { outcome: "error" }, { outcome: "error" }, { outcome: "error" },
      { outcome: "ok" },
    ];
    const result = await checkObservability(env, makeFetch(200, events));
    assert.equal(result.status, "degraded");
    assert.equal(result.recentEvents, 4);
    assert.ok(result.errorRate !== null && result.errorRate > 20);
  });

  test("200 with no events → ok but advisory", async () => {
    const result = await checkObservability(env, makeFetch(200, []));
    assert.equal(result.status, "ok");
    assert.equal(result.recentEvents, 0);
    assert.ok(result.nextAction.includes("debug events"));
  });

  test("404 → degraded (table not found)", async () => {
    const result = await checkObservability(env, makeFetch(404, { message: "Not Found" }));
    assert.equal(result.status, "degraded");
    assert.ok(result.nextAction.includes("migrations"));
  });

  test("500 → error status", async () => {
    const result = await checkObservability(env, makeFetch(500, {}));
    assert.equal(result.status, "error");
  });

  test("network error → error status", async () => {
    const errorFetch: typeof fetch = async () => { throw new Error("ECONNREFUSED"); };
    const result = await checkObservability(env, errorFetch);
    assert.equal(result.status, "error");
  });
});

describe("checkObservability — key never in output", () => {
  test("service role key never appears in message", async () => {
    const env = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "ultra-secret-key-value",
    };
    const result = await checkObservability(env, makeFetch(200, []));
    assert.ok(!result.message.includes("ultra-secret-key-value"), "Message must not contain service role key");
    assert.ok(!result.nextAction.includes("ultra-secret-key-value"), "nextAction must not contain key");
  });

  test("key never appears in request URL", async () => {
    let capturedUrl = "";
    const captureFetch: typeof fetch = async (input) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify([]), { status: 200 });
    };
    const env = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "captured-secret-key",
    };
    await checkObservability(env, captureFetch);
    assert.ok(!capturedUrl.includes("captured-secret-key"), "URL must not contain service role key");
  });
});
