import { test } from "node:test";
import assert from "node:assert/strict";
import { councilOrgan } from "../src/organs/adapters/council.js";

const NOW = "2026-06-14T00:00:00Z";

test("councilOrgan declares the contracted identity + arming gate", () => {
  assert.equal(councilOrgan.organId, "council");
  assert.equal(councilOrgan.armingFlag, "HARTOS_ALLOW_COUNCIL");
  assert.equal(typeof councilOrgan.run, "function");
});

test("run() with no goal returns an honest PARTIAL (ok:false) — never invents a goal", async () => {
  // No HARTOS_COUNCIL_GOAL ⇒ no autonomous goal source ⇒ honest PARTIAL, not a fabricated success.
  const res = await councilOrgan.run({} as NodeJS.ProcessEnv, NOW);
  assert.equal(res.ok, false);
  assert.equal(res.outputRef, null);
  assert.equal(res.summary, "council needs HARTOS_COUNCIL_GOAL (no autonomous goal source)");
});

test("run() with a whitespace-only goal is still treated as no goal (honest PARTIAL)", async () => {
  const res = await councilOrgan.run({ HARTOS_COUNCIL_GOAL: "   " } as NodeJS.ProcessEnv, NOW);
  assert.equal(res.ok, false);
  assert.match(res.summary, /HARTOS_COUNCIL_GOAL/);
});

test("run() with a goal produces a propose-only council plan (ok:true) with a proposal handle", async () => {
  // Bounded: the adapter runs runCouncil LLM-off, so this stays offline and triggers no model calls.
  const res = await councilOrgan.run(
    { HARTOS_COUNCIL_GOAL: "should HartOS add a budget organ?" } as NodeJS.ProcessEnv,
    NOW,
  );
  assert.equal(res.ok, true);
  // outputRef is the SOT-readable council proposal id, never null on success.
  assert.ok(typeof res.outputRef === "string");
  assert.match(res.outputRef as string, /^prop-council-/);
  assert.match(res.summary, /Council verdict/);
  assert.match(res.summary, /propose-only/);
});

test("run() always returns a well-formed OrganRunResult shape (with and without a goal)", async () => {
  for (const env of [{}, { HARTOS_COUNCIL_GOAL: "a real goal" }] as NodeJS.ProcessEnv[]) {
    const res = await councilOrgan.run(env, NOW);
    assert.equal(typeof res.ok, "boolean");
    // outputRef is a SOT-readable handle (string) or null — never undefined.
    assert.ok(res.outputRef === null || typeof res.outputRef === "string");
    assert.equal(typeof res.summary, "string");
    assert.ok(res.summary.length > 0 && res.summary.length < 300);
    if (res.detail !== undefined) {
      assert.equal(typeof res.detail, "object");
    }
  }
});

test("run() never throws, even on junk env and an unparseable clock", async () => {
  await assert.doesNotReject(async () => {
    await councilOrgan.run({ HARTOS_ALLOW_COUNCIL: "" } as NodeJS.ProcessEnv, NOW);
  });
  await assert.doesNotReject(async () => {
    // A junk clock must not throw the adapter (the proposal id falls back to the epoch).
    await councilOrgan.run({ HARTOS_COUNCIL_GOAL: "x" } as NodeJS.ProcessEnv, "not-a-date");
  });
});
