import { test } from "node:test";
import assert from "node:assert/strict";
import { wolverineOrgan } from "../src/organs/adapters/wolverine.js";

const NOW = "2026-06-14T00:00:00Z";

test("wolverineOrgan declares the contracted identity + arming gate", () => {
  assert.equal(wolverineOrgan.organId, "wolverine");
  assert.equal(wolverineOrgan.armingFlag, "HARTOS_ALLOW_WOLVERINE_AUDIT");
  assert.equal(typeof wolverineOrgan.run, "function");
});

test("run() returns a well-formed OrganRunResult and never throws", async () => {
  // The pure audit runs directly; it needs no network/spine, so this produces a real report.
  const res = await wolverineOrgan.run({}, NOW);

  assert.equal(typeof res.ok, "boolean");
  // outputRef is a SOT-readable handle (string) or null — never undefined.
  assert.ok("outputRef" in res);
  assert.ok(res.outputRef === null || typeof res.outputRef === "string");
  assert.equal(typeof res.summary, "string");
  assert.ok(res.summary.length > 0 && res.summary.length <= 300);
  // detail is optional; if present it must be an object.
  if (res.detail !== undefined) {
    assert.equal(typeof res.detail, "object");
  }
});

test("run() on a successful audit reports ok:true with an audit:<n> findings handle (advisory only)", async () => {
  const res = await wolverineOrgan.run({}, NOW);

  // The aggregator is internally crash-proof, so a normal run yields a report => ok:true.
  assert.equal(res.ok, true);
  assert.ok(res.outputRef !== null && /^audit:\d+ findings$/.test(res.outputRef));
  // Advisory only: the detail must never claim an executed fix.
  assert.ok(res.detail);
  assert.equal((res.detail as Record<string, unknown>).advisoryOnly, true);
  assert.equal(typeof (res.detail as Record<string, unknown>).verdict, "string");
});

test("run() never throws, even on a junk env", async () => {
  await assert.doesNotReject(async () => {
    await wolverineOrgan.run({ HARTOS_ALLOW_WOLVERINE_AUDIT: "" } as NodeJS.ProcessEnv, NOW);
  });
});
