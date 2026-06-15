import { test } from "node:test";
import assert from "node:assert/strict";
import { fitnessOrgan } from "../src/organs/adapters/fitness.js";

const NOW = "2026-06-14T00:00:00Z";

test("fitnessOrgan declares the contracted identity + arming gate", () => {
  assert.equal(fitnessOrgan.organId, "fitness");
  assert.equal(fitnessOrgan.armingFlag, "HARTOS_FITNESS_POLL");
  assert.equal(typeof fitnessOrgan.run, "function");
});

test("run() with empty env returns a well-formed, honest ok:false (no spine DB)", async () => {
  // {} => HARTOS_SUPABASE_DB_URL absent => createCockpitProposalDb returns null.
  const res = await fitnessOrgan.run({}, NOW);

  // Honest result: no DB means no evidence means not ok. Never fabricate ok:true.
  assert.equal(res.ok, false);
  assert.equal(res.outputRef, null);
  assert.equal(res.summary, "no spine DB configured");
});

test("run() always returns a well-formed OrganRunResult shape", async () => {
  const res = await fitnessOrgan.run({}, NOW);

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

test("run() never throws, even on a junk env", async () => {
  await assert.doesNotReject(async () => {
    await fitnessOrgan.run({ HARTOS_SUPABASE_DB_URL: "" }, NOW);
  });
});
