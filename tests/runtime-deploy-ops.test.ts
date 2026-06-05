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
    } as Response;
  }) as typeof fetch;
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

  it("real workerHealth probes <url>/health read-only and reports status", async () => {
    const urls: string[] = [];
    const ops = realRuntimeDeployOps({ env: {}, fetchImpl: fakeFetch(urls) });
    const r = await ops.workerHealth("https://w.example.com/");
    assert.equal(r.success, true);
    assert.equal(r.data?.status, 200);
    assert.ok(urls.some((u) => u === "https://w.example.com/health"));
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
