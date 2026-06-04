import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("live smoke mutation is gated", async () => {
  const body = await readFile("scripts/smoke-live.ts", "utf8");
  assert.ok(body.includes("ALLOW_LIVE_SMOKE_MUTATION"));
  assert.ok(body.includes("skipped; set ALLOW_LIVE_SMOKE_MUTATION=true"));
});

test("Telegram test send is gated", async () => {
  const body = await readFile("src/telegram/sender.ts", "utf8");
  assert.ok(body.includes("ALLOW_TELEGRAM_TEST_SEND"));
  assert.ok(body.includes("TEST_TELEGRAM_CHAT_ID"));
});
