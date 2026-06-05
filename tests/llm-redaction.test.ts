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
// Telegram bot token (<bot id>:<secret>) and the API URL that embeds it — constructed at runtime.
const TG_TOKEN = "123456789" + ":" + "A".repeat(35);
const TG_URL = "https://api.telegram.org/bot" + TG_TOKEN + "/getMe";

describe("llm redaction", () => {
  const secrets = [SK, GH, BEARER, JWT, TG_TOKEN, TG_URL];

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

  it("Fix #4 — detects a Telegram token embedded in an API URL (network-error shape)", () => {
    const errLike = `getMe network error: failed to fetch ${TG_URL}`;
    assert.equal(containsSecret(errLike), true);
    const r = redact(errLike);
    assert.equal(containsSecret(r), false);
    assert.equal(r.includes(TG_TOKEN), false, "token must not survive redaction");
  });

  it("Fix #4 — deep-redact strips a Telegram token URL from a report-shaped object", () => {
    const report = { mode: "deploy_failed", steps: [{ step: "set_webhook", message: `error at ${TG_URL}` }] };
    const out = redactDeep(report);
    assert.equal(containsSecret(JSON.stringify(out)), false);
    assert.equal(JSON.stringify(out).includes(TG_TOKEN), false);
  });
});
