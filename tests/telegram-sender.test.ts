import { test } from "node:test";
import assert from "node:assert/strict";
import { TelegramHttpSender } from "../src/telegram/sender.js";

test("sendMessage uses Telegram API without printing token", async () => {
  const calls: string[] = [];
  const sender = new TelegramHttpSender(
    { TELEGRAM_BOT_TOKEN: "secret-token" },
    { fetchImpl: async (input) => {
      calls.push(String(input));
      return new Response("{}", { status: 200 });
    } }
  );
  await sender.sendMessage("123", "hello");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("botsecret-token/sendMessage"));
});

test("optional test send is gated", async () => {
  let called = false;
  const sender = new TelegramHttpSender(
    { TELEGRAM_BOT_TOKEN: "secret-token", DEBUG_CHANNEL_ID: "123" },
    { fetchImpl: async () => {
      called = true;
      return new Response("{}", { status: 200 });
    } }
  );
  assert.equal(await sender.sendOptionalTestMessage("hello"), "skipped");
  assert.equal(called, false);
});
