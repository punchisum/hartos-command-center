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
// Postgres connection string with an embedded password — a pg/TLS error can echo it verbatim.
const DB_PASS = "p" + "x".repeat(24);
const DB_URL = "postgres://postgres:" + DB_PASS + "@db.xbuinrnpfjltimofwrdx.supabase.co:5432/postgres";

describe("llm redaction", () => {
  const secrets = [SK, GH, BEARER, JWT, TG_TOKEN, TG_URL, DB_URL];

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

  it("does NOT false-match hyphenated words that merely end in sk- (risk-/task-/ask-)", () => {
    // The EBRD citation URL that wrongly tripped the dossier vault write.
    const url = "https://www.ebrd.com/.../ebrd-and-aon-launch-innovative-war-risk-insurance-facility-for-u.html";
    assert.equal(containsSecret(url), false);
    assert.equal(containsSecret("a task-management-platform-for-teams"), false);
    // A real standalone sk- key is still caught (boundary at the token start).
    assert.equal(containsSecret("OPENAI_API_KEY=sk-" + "a".repeat(28)), true);
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

  it("redacts a Postgres connection string from a pg/TLS error message (password must not survive)", () => {
    const errLike = `connection error: could not connect to ${DB_URL} (self-signed certificate)`;
    assert.equal(containsSecret(errLike), true);
    const r = redact(errLike);
    assert.equal(containsSecret(r), false);
    assert.equal(r.includes(DB_PASS), false, "the DB password must not survive redaction");
  });

  it("does NOT false-match a credential-free URL", () => {
    assert.equal(containsSecret("https://hartos-command-center.hartos.workers.dev/health"), false);
    assert.equal(containsSecret("postgres docs at https://www.postgresql.org/docs/"), false);
  });
});
