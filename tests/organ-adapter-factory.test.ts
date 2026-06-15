import { test } from "node:test";
import assert from "node:assert/strict";
import { factoryOrgan } from "../src/organs/adapters/factory.js";

const NOW = "2026-06-15T00:00:00Z";

test("factoryOrgan declares the contracted identity + build arming gate", () => {
  assert.equal(factoryOrgan.organId, "factory");
  // Armed to BUILD only when a real scaffold write is permitted (18A entry gate / Key 2).
  assert.equal(factoryOrgan.armingFlag, "ALLOW_LOCAL_SCAFFOLD");
  assert.equal(typeof factoryOrgan.run, "function");
});

test("run() returns a well-formed OrganRunResult and never throws", async () => {
  // Empty env ⇒ no spine DB ⇒ the side-effect-free interrogate fallback runs (offline, no fs/net).
  const res = await factoryOrgan.run({} as NodeJS.ProcessEnv, NOW);

  assert.equal(typeof res.ok, "boolean");
  // outputRef is a SOT-readable handle (string) or null — never undefined.
  assert.ok("outputRef" in res);
  assert.ok(res.outputRef === null || typeof res.outputRef === "string");
  assert.equal(typeof res.summary, "string");
  assert.ok(res.summary.length > 0 && res.summary.length <= 300);
  if (res.detail !== undefined) {
    assert.equal(typeof res.detail, "object");
  }
});

test("run() with no spine DB is an honest PARTIAL: interrogate-ready, no approved spec to build", async () => {
  // No spine DB ⇒ nothing to build. The interrogate fallback proves the spec pipeline is importable,
  // but interrogate-readiness is NOT a completed build, so ok MUST be false (never fabricated).
  const res = await factoryOrgan.run({} as NodeJS.ProcessEnv, NOW);

  assert.equal(res.ok, false);
  assert.match(res.summary, /interrogate-ready/i);
  assert.match(res.summary, /no approved spec to build|PARTIAL/i);
  // The fallback surfaces a questions handle as evidence the interrogation pipeline is callable.
  assert.ok(typeof res.outputRef === "string");
  assert.match(res.outputRef as string, /^questions:\d+$/);
  assert.equal((res.detail as Record<string, unknown>).partial, true);
});

test("run() never throws even on a junk env and an unparseable clock", async () => {
  await assert.doesNotReject(async () => {
    await factoryOrgan.run({ ALLOW_LOCAL_SCAFFOLD: "true" } as NodeJS.ProcessEnv, NOW);
  });
  await assert.doesNotReject(async () => {
    await factoryOrgan.run({} as NodeJS.ProcessEnv, "not-a-date");
  });
});
