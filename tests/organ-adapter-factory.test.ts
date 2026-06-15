import { test } from "node:test";
import assert from "node:assert/strict";
import { factoryOrgan } from "../src/organs/adapters/factory.js";

const NOW = "2026-06-14T00:00:00Z";

test("factoryOrgan declares the contracted identity + arming gate", () => {
  assert.equal(factoryOrgan.organId, "factory");
  assert.equal(factoryOrgan.armingFlag, "ALLOW_CODE_BUILD");
  assert.equal(typeof factoryOrgan.run, "function");
});

test("run() returns a well-formed OrganRunResult and never throws", async () => {
  // interrogateSpec() is PURE (no fs/net/clock), so this runs offline with an empty env.
  const res = await factoryOrgan.run({} as NodeJS.ProcessEnv, NOW);

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

test("run() is an honest PARTIAL: ok:false because build/deploy is disarmed (#8)", async () => {
  // The interrogator works, but a callable pipeline is interrogate-readiness, NOT a completed
  // build. CONSTRAINT #8 forbids external execution, so ok MUST be false (never fabricated).
  const res = await factoryOrgan.run({} as NodeJS.ProcessEnv, NOW);

  assert.equal(res.ok, false);
  assert.match(res.summary, /interrogate-ready/i);
  assert.match(res.summary, /disarmed \(#8\)/i);
});

test("run() produces a questions handle as evidence the interrogation pipeline is callable", async () => {
  const res = await factoryOrgan.run({} as NodeJS.ProcessEnv, NOW);

  // outputRef is a spec/questions handle (questions:<n>) when a real question set is produced.
  assert.ok(typeof res.outputRef === "string");
  assert.match(res.outputRef as string, /^questions:\d+$/);
  // detail surfaces the interrogate-readiness evidence honestly.
  assert.equal((res.detail as Record<string, unknown>).interrogateReady, true);
  assert.ok(((res.detail as Record<string, unknown>).questionCount as number) > 0);
});

test("run() never throws even on a junk env and an unparseable clock", async () => {
  await assert.doesNotReject(async () => {
    await factoryOrgan.run({ ALLOW_CODE_BUILD: "true" } as NodeJS.ProcessEnv, NOW);
  });
  await assert.doesNotReject(async () => {
    await factoryOrgan.run({} as NodeJS.ProcessEnv, "not-a-date");
  });
});
