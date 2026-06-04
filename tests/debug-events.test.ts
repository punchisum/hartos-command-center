import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeMetadata } from "../src/lib/debug.js";
import { makeIdempotencyKey } from "../src/lib/idempotency.js";

test("debug metadata redacts secrets", () => {
  const sanitized = sanitizeMetadata({
    apiKey: "sk-testvalue1234567890",
    nested: { authorization: "Bearer abc" },
  });
  assert.equal(sanitized.apiKey, "[REDACTED]");
  assert.deepEqual(sanitized.nested, { authorization: "[REDACTED]" });
});

test("idempotency key generated from trusted fields only", () => {
  assert.equal(
    makeIdempotencyKey([
      { source: "record_id", value: "abc" },
      { source: "date_string", value: "2026-06-03" },
    ]),
    "record_id:abc|date_string:2026-06-03"
  );
  assert.throws(
    () => makeIdempotencyKey([{ source: "llm_generated_text", value: "summary" }]),
    /Forbidden idempotency source/
  );
});
