import { test } from "node:test";
import assert from "node:assert/strict";
import { routeTelegramUpdate } from "../src/telegram/router.js";
import type { RuntimeDeps } from "../src/shared/types.js";

function deps(): RuntimeDeps & { sent: string[]; enqueued: string[] } {
  const sent: string[] = [];
  const enqueued: string[] = [];
  return {
    sent,
    enqueued,
    sender: { async sendMessage(_chatId, text) { sent.push(text); } },
    trigger: { async enqueue(command) { enqueued.push(command); } },
    supabase: { async insertDebugEvent() {}, async insertCommandEvent() {} },
  };
}

test("unauthorized Telegram update is rejected", async () => {
  const result = await routeTelegramUpdate(
    { message: { chat: { id: "2" }, from: { id: "2" }, text: "/help" } },
    { TELEGRAM_ALLOWED_USER_IDS: "1", TELEGRAM_ALLOWED_CHAT_IDS: "1" },
    deps()
  );
  assert.equal(result.status, "rejected");
});

test("authorized /help is routed", async () => {
  const runtimeDeps = deps();
  const result = await routeTelegramUpdate(
    { message: { chat: { id: "1" }, from: { id: "1" }, text: "/help" } },
    { TELEGRAM_ALLOWED_USER_IDS: "1", TELEGRAM_ALLOWED_CHAT_IDS: "1" },
    runtimeDeps
  );
  assert.equal(result.route, "help");
  assert.match(runtimeDeps.sent[0] ?? "", /Available commands/);
});

test("generated command routes to placeholder handler", async () => {
  const runtimeDeps = deps();
  const result = await routeTelegramUpdate(
    { message: { chat: { id: "1" }, from: { id: "1" }, text: "/analyse" } },
    { TELEGRAM_ALLOWED_USER_IDS: "1", TELEGRAM_ALLOWED_CHAT_IDS: "1" },
    runtimeDeps
  );
  assert.equal(result.route, "analyse");
  assert.deepEqual(runtimeDeps.enqueued, ["analyse"]);
});

test("callback tok:abc routes to token validation path", async () => {
  const runtimeDeps = deps();
  const result = await routeTelegramUpdate(
    { callback_query: { data: "tok:abc", message: { chat: { id: "1" } }, from: { id: "1" } } },
    { TELEGRAM_ALLOWED_USER_IDS: "1", TELEGRAM_ALLOWED_CHAT_IDS: "1" },
    runtimeDeps
  );
  assert.equal(result.route, "callback_token_validation");
  assert.deepEqual(runtimeDeps.enqueued, ["callback-token"]);
});

test("callback_data longer than 64 bytes is rejected", async () => {
  await assert.rejects(
    () => routeTelegramUpdate(
      { callback_query: { data: `tok:${"a".repeat(70)}`, message: { chat: { id: "1" } }, from: { id: "1" } } },
      { TELEGRAM_ALLOWED_USER_IDS: "1", TELEGRAM_ALLOWED_CHAT_IDS: "1" },
      deps()
    ),
    /64 bytes/
  );
});
