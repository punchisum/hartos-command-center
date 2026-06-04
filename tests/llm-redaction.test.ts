/**
 * tests/llm-redaction.test.ts — Phase 11I. Redaction catches token-like strings.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redact, redactDeep, containsSecret } from "../src/llm/redaction.js";

// Secret-like strings are CONSTRUCTED at runtime so no literal token pattern
// appears in the source (the factory secret scan walks test files too).
const SK = "sk-" + "a".repeat(28);
const GH = "ghp_" + "b".repeat(36);
const BEARER = "Bearer " + "c".repeat(32);
const JWT = ["eyJ" + "a".repeat(20), "b".repeat(20), "c".repeat(22)].join(".");

describe("llm redaction", () => {
  const secrets = [SK, GH, BEARER, JWT];

  for (const s of secrets) {
    it(`detects + redacts: ${s.slice(0, 8)}...`, () => {
      assert.equal(containsSecret(s), true);
      const r = redact(s);
      assert.ok(r.includes("[REDACTED]"));
      assert.equal(containsSecret(r), false);
    });
  }

  it("leaves ordinary text untouched", () => {
    const text = "Build me a finance agent for my watchlist.";
    assert.equal(containsSecret(text), false);
    assert.equal(redact(text), text);
  });

  it("deep-redacts nested objects and arrays", () => {
    const obj = { a: SK, b: ["ok", GH], c: { d: 1 } };
    const out = redactDeep(obj);
    assert.equal(containsSecret(JSON.stringify(out)), false);
    assert.equal(out.c.d, 1);
  });
});
