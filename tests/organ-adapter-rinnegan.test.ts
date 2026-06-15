import { test } from "node:test";
import assert from "node:assert/strict";
import { rinneganOrgan } from "../src/organs/adapters/rinnegan.js";

const NOW = "2026-06-14T00:00:00Z";

test("rinneganOrgan declares the contracted identity + arming gate", () => {
  assert.equal(rinneganOrgan.organId, "rinnegan");
  assert.equal(rinneganOrgan.armingFlag, "HARTOS_ALLOW_RINNEGAN_SYNC");
  assert.equal(typeof rinneganOrgan.run, "function");
});

test("run() returns a well-formed OrganRunResult shape", async () => {
  const res = await rinneganOrgan.run({}, NOW);

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

test("run() compiles a non-empty context pack from the seed input (honest ok:true)", async () => {
  // The compiler is pure + deterministic; our seed note's terms overlap the intent, so the
  // scorer keeps it and ok must be true with a context-pack handle.
  const res = await rinneganOrgan.run({}, NOW);

  assert.equal(res.ok, true);
  assert.equal(typeof res.outputRef, "string");
  assert.match(res.outputRef as string, /^context-pack:\d+ items$/);
});

test("run() never throws, even on a junk env / now", async () => {
  await assert.doesNotReject(async () => {
    await rinneganOrgan.run({ HARTOS_ALLOW_RINNEGAN_SYNC: "" }, NOW);
  });
  await assert.doesNotReject(async () => {
    await rinneganOrgan.run({}, "not-a-date");
  });
});
