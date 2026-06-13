/**
 * tests/self-mod-post-verify.test.ts — P6: the post-modification safety gate (pure, fail-closed).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { postVerifySelfMod } from "../src/execution/self-mod-post-verify.js";

describe("postVerifySelfMod", () => {
  it("ok when all files are in scope and no secret leaks", () => {
    const r = postVerifySelfMod(["src/cockpit/cockpit.ts", "src/fitness/coaching-core.ts"], "+ const x = 1;");
    assert.equal(r.ok, true);
    assert.deepEqual(r.violations, []);
  });

  it("flags an out-of-scope file (mutation adapter)", () => {
    const r = postVerifySelfMod(["src/execution/adapters/clickup-comment.ts"], "+ x");
    assert.equal(r.ok, false);
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].kind, "out-of-scope");
    assert.match(r.violations[0].detail, /clickup-comment/);
  });

  it("flags a file outside src/", () => {
    const r = postVerifySelfMod(["package.json"], "+ x");
    assert.equal(r.ok, false);
    assert.equal(r.violations[0].kind, "out-of-scope");
  });

  it("flags a secret leak in the diff", () => {
    const r = postVerifySelfMod(["src/cockpit/cockpit.ts"], '+ const k = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";');
    assert.equal(r.ok, false);
    assert.ok(r.violations.some((v) => v.kind === "secret-leak"));
  });

  it("accumulates multiple violations (out-of-scope + secret)", () => {
    const r = postVerifySelfMod(
      ["src/execution/adapters/refresh-sync.ts"],
      '+ token = "sk-ant-api03-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"',
    );
    assert.equal(r.ok, false);
    assert.ok(r.violations.some((v) => v.kind === "out-of-scope"));
    assert.ok(r.violations.some((v) => v.kind === "secret-leak"));
  });

  it("empty change set is vacuously ok", () => {
    const r = postVerifySelfMod([], "");
    assert.equal(r.ok, true);
  });
});
