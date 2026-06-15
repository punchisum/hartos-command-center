import { test } from "node:test";
import assert from "node:assert/strict";
import { beezulbubOrgan } from "../src/organs/adapters/beezulbub.js";

const NOW = "2026-06-14T00:00:00Z";

test("beezulbubOrgan declares the contracted identity + arming gate", () => {
  assert.equal(beezulbubOrgan.organId, "beezulbub");
  assert.equal(beezulbubOrgan.armingFlag, "BEEZULBUB_ALLOW_NETWORK");
  assert.equal(typeof beezulbubOrgan.run, "function");
});

test("run() with empty env returns an honest ok:false PARTIAL (network disarmed → fixtures)", async () => {
  // {} => BEEZULBUB_ALLOW_NETWORK unset => the hunt's live scout falls back to fixtures (honestly
  // labelled mode=fixture) and the vault write is unconfigured. That is NOT a live success, so the
  // adapter must report an honest PARTIAL — never fabricate ok:true.
  const res = await beezulbubOrgan.run({}, NOW);

  assert.equal(res.ok, false);
  assert.ok(/PARTIAL/i.test(res.summary), `summary should flag PARTIAL, got: ${res.summary}`);
});

test("run() always returns a well-formed OrganRunResult shape", async () => {
  const res = await beezulbubOrgan.run({}, NOW);

  assert.equal(typeof res.ok, "boolean");
  // outputRef is a SOT-readable handle (string) or null — never undefined.
  assert.ok(res.outputRef === null || typeof res.outputRef === "string");
  assert.equal(typeof res.summary, "string");
  assert.ok(res.summary.length > 0 && res.summary.length < 300);
  // detail is optional; if present it must be an object.
  if (res.detail !== undefined) {
    assert.equal(typeof res.detail, "object");
  }
});

test("run() never throws, even on a junk env and an unparseable clock", async () => {
  await assert.doesNotReject(async () => {
    await beezulbubOrgan.run({ BEEZULBUB_ALLOW_NETWORK: "" }, NOW);
  });
  await assert.doesNotReject(async () => {
    await beezulbubOrgan.run({}, "not-a-date");
  });
});
