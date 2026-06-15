import { test } from "node:test";
import assert from "node:assert/strict";
import { prophetOrgan } from "../src/organs/adapters/prophet.js";

const NOW = "2026-06-14T00:00:00Z";

test("prophetOrgan declares the contracted identity + arming gate", () => {
  assert.equal(prophetOrgan.organId, "prophet");
  assert.equal(prophetOrgan.armingFlag, "HARTOS_ALLOW_PROPHET_PULSE");
  assert.equal(typeof prophetOrgan.run, "function");
});

test("run() with empty env returns a well-formed ok:true forecast (pure synthesis)", async () => {
  // forecast() is pure with every input but `now` optional, so a minimal call yields a real
  // report — honestly `stable` with explicit blind spots, not a fabricated success.
  const res = await prophetOrgan.run({}, NOW);

  assert.equal(res.ok, true);
  assert.ok(typeof res.outputRef === "string" && res.outputRef!.startsWith("forecast:"));
  assert.ok(res.summary.startsWith("Forecast"));
});

test("run() always returns a well-formed OrganRunResult shape", async () => {
  const res = await prophetOrgan.run({}, NOW);

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
    await prophetOrgan.run({ HARTOS_ALLOW_PROPHET_PULSE: "" }, NOW);
  });
  await assert.doesNotReject(async () => {
    // forecast() Date.parse's `now`; a junk clock must still not throw the adapter.
    await prophetOrgan.run({}, "not-a-date");
  });
});
