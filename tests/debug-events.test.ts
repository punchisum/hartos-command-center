import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeMetadata } from "../src/lib/debug.js";

test("debug metadata redacts secrets", () => {
  const sanitized = sanitizeMetadata({
    apiKey: "sk-testvalue1234567890",
    nested: { authorization: "Bearer abc" },
  });
  assert.equal(sanitized.apiKey, "[REDACTED]");
  assert.deepEqual(sanitized.nested, { authorization: "[REDACTED]" });
});
