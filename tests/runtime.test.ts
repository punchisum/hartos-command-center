import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/runtime/cloudflare-worker.js";

test("health endpoint returns ok", async () => {
  const response = await handleRequest(new Request("http://local.test/health"), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});
