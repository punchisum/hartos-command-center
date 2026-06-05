/**
 * tests/runtime-deploy-ops.test.ts
 *
 * Phase 18D — the composed runtime ops boundary. Hermetic: a throwing global fetch is installed and
 * an injected fetchImpl returns canned responses. Proves: the mock ops are all-success and leak no
 * secret; the real composed ops NEVER surface the bot token in any message/data; and the boundary
 * fails closed (no spawn, no network) when a required secret is absent.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  realRuntimeDeployOps,
  createMockRuntimeDeployOps,
} from "../src/runtime-provision/runtime-deploy-ops.js";

const BOT_TOKEN = "123456789:ABCDEF_super_secret_bot_token_value_1234567890";

/** A fetch that returns Telegram-style ok JSON, recording every URL it was called with. */
function fakeFetch(calledUrls: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    calledUrls.push(url);
    const body = url.includes("getMe")
      ? { ok: true, result: { username: "testbot", id: 123456 } }
      : url.includes("getWebhookInfo")
        ? { ok: true, result: { url: "", pending_update_count: 0 } }
        : { ok: true, description: "ok" };
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify({ status: "ok" }),
    } as unknown as Response;
  }) as typeof fetch;
}

/** Build a one-off fetch returning a specific status + body text (for health-probe tests). */
function healthFetch(status: number, bodyText: string): typeof fetch {
  return (async () => ({ ok: status >= 200 && status < 300, status, text: async () => bodyText, json: async () => ({}) }) as unknown as Response) as typeof fetch;
}

describe("18D runtime-deploy-ops (no real provider)", () => {
  const realFetch = globalThis.fetch;
  before(() => {
    globalThis.fetch = (() => {
      throw new Error("network call attempted in 18D ops test");
    }) as typeof fetch;
  });
  after(() => {
    globalThis.fetch = realFetch;
  });

  it("mock ops are all-success and contain no secret-shaped values", async () => {
    const ops = createMockRuntimeDeployOps();
    const results = [
      await ops.workerExists("staging"),
      await ops.uploadSecrets("staging", { TELEGRAM_BOT_TOKEN: BOT_TOKEN }),
      await ops.deployWorker("staging"),
      await ops.workerHealth("https://w.example.com"),
      await ops.deployTasks("/tmp/x", "staging"),
      await ops.getMe(),
      await ops.getWebhookInfo(),
      await ops.setWebhook("https://w.example.com/telegram/webhook", "s"),
      await ops.deleteWebhook(),
    ];
    for (const r of results) {
      assert.equal(r.success, true);
      assert.equal(JSON.stringify(r).includes(BOT_TOKEN), false, "mock result must not echo a secret");
    }
    // uploadSecrets surfaces NAMES + count only, never the value.
    const up = await ops.uploadSecrets("staging", { TELEGRAM_BOT_TOKEN: BOT_TOKEN, OPENAI_API_KEY: "sk-xxx" });
    assert.equal(up.data?.count, 2);
    assert.deepEqual(up.data?.names, ["TELEGRAM_BOT_TOKEN", "OPENAI_API_KEY"]);
    assert.equal(JSON.stringify(up).includes(BOT_TOKEN), false);
  });

  it("real composed Telegram ops NEVER surface the bot token in any message/data", async () => {
    const urls: string[] = [];
    const ops = realRuntimeDeployOps({ env: { TELEGRAM_BOT_TOKEN: BOT_TOKEN }, fetchImpl: fakeFetch(urls) });
    const results = [await ops.getMe(), await ops.getWebhookInfo(), await ops.setWebhook("https://w/x", "s"), await ops.deleteWebhook()];
    for (const r of results) {
      assert.equal(JSON.stringify(r).includes(BOT_TOKEN), false, "ops result must not contain the bot token");
    }
    // The token DID travel in the API URL (that's expected) — proving the redaction matters.
    assert.ok(urls.some((u) => u.includes(BOT_TOKEN)), "sanity: token is used in the API URL");
  });

  it("Fix #4 — telegram-local sanitize strips a token URL from a thrown network error", async () => {
    const tokenUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getMe`;
    const throwingFetch = (async () => {
      throw new Error(`request to ${tokenUrl} failed`);
    }) as typeof fetch;
    const ops = realRuntimeDeployOps({ env: { TELEGRAM_BOT_TOKEN: BOT_TOKEN }, fetchImpl: throwingFetch });
    const r = await ops.getMe();
    assert.equal(r.success, false);
    assert.equal(r.message.includes(BOT_TOKEN), false, "thrown-error message must not contain the bot token");
    assert.match(r.message, /bot\[REDACTED\]/);
  });

  it("real workerHealth probes <url>/health read-only and reports status", async () => {
    const urls: string[] = [];
    const ops = realRuntimeDeployOps({ env: {}, fetchImpl: fakeFetch(urls) });
    const r = await ops.workerHealth("https://w.example.com/");
    assert.equal(r.success, true);
    assert.equal(r.data?.status, 200);
    assert.ok(urls.some((u) => u === "https://w.example.com/health"));
  });

  it("Fix #2 — workerHealth times out (never-resolving fetch) → success:false", async () => {
    const neverFetch = (() => new Promise(() => {})) as typeof fetch;
    const ops = realRuntimeDeployOps({ env: {}, fetchImpl: neverFetch });
    const r = await ops.workerHealth("https://w.example.com", 30); // tiny timeout for the test
    assert.equal(r.success, false);
    assert.match(r.message, /timed out/i);
  });

  it("Fix #2 — HTTP 200 with irrelevant body → success:false", async () => {
    const ops = realRuntimeDeployOps({ env: {}, fetchImpl: healthFetch(200, "<html>welcome</html>") });
    const r = await ops.workerHealth("https://w.example.com", 1000);
    assert.equal(r.success, false);
    assert.match(r.message, /not a recognizable health response/);
  });

  it("Fix #2 — HTTP 200 with health marker → success:true", async () => {
    const ops = realRuntimeDeployOps({ env: {}, fetchImpl: healthFetch(200, '{"status":"ok"}') });
    const r = await ops.workerHealth("https://w.example.com", 1000);
    assert.equal(r.success, true);
    assert.equal(r.data?.status, 200);
  });

  it("Fix #2 — non-200 → success:false", async () => {
    const ops = realRuntimeDeployOps({ env: {}, fetchImpl: healthFetch(503, "healthy") });
    const r = await ops.workerHealth("https://w.example.com", 1000);
    assert.equal(r.success, false);
    assert.match(r.message, /HTTP 503/);
  });

  it("Fix #2 — health error messages are sanitized (no leaked token)", async () => {
    const tokenUrl = `https://api.telegram.org/bot${BOT_TOKEN}/x`;
    const throwingFetch = (() => Promise.reject(new Error(`connect fail ${tokenUrl}`))) as typeof fetch;
    const ops = realRuntimeDeployOps({ env: {}, fetchImpl: throwingFetch });
    const r = await ops.workerHealth("https://w.example.com", 1000);
    assert.equal(r.success, false);
    assert.equal(r.message.includes(BOT_TOKEN), false);
  });

  it("fails closed (no network/spawn) when TELEGRAM_BOT_TOKEN absent", async () => {
    const ops = realRuntimeDeployOps({ env: {} }); // no token, no fetchImpl needed
    const r = await ops.setWebhook("https://w/x");
    assert.equal(r.success, false);
    assert.match(r.message, /TELEGRAM_BOT_TOKEN not set/);
  });

  it("fails closed (no spawn) when TRIGGER_SECRET_KEY absent", async () => {
    const ops = realRuntimeDeployOps({ env: {} });
    const r = await ops.deployTasks("/tmp/x", "staging");
    assert.equal(r.success, false);
    assert.match(r.message, /TRIGGER_SECRET_KEY not set/);
  });
});
