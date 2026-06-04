import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryActionTokenStore, issueActionToken, runApprovedAction } from "../src/lib/action-tokens.js";

async function seededStore(): Promise<{ store: InMemoryActionTokenStore; tok: string }> {
  const store = new InMemoryActionTokenStore();
  const record = await issueActionToken(store, {
    actionCode: "approve",
    entityType: "report",
    entityId: null,
    telegramChatId: "123",
    telegramUserId: "456",
    payload: {},
    expiresAt: new Date(Date.now() + 60_000),
  });
  return { store, tok: record.tok };
}

test("action token not consumed on failed action", async () => {
  const { store, tok } = await seededStore();
  await assert.rejects(() => runApprovedAction(store, tok, async () => {
    throw new Error("mutation failed");
  }));
  assert.equal((await store.find(tok))?.consumedAt, null);
});

test("action token consumed after success", async () => {
  const { store, tok } = await seededStore();
  await runApprovedAction(store, tok, async () => {});
  assert.ok((await store.find(tok))?.consumedAt instanceof Date);
});
