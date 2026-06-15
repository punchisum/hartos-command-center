import { test } from "node:test";
import assert from "node:assert/strict";
import { cockpitOrgan } from "../src/organs/adapters/cockpit.js";

test("cockpitOrgan is a well-formed always-on adapter", () => {
  assert.equal(cockpitOrgan.organId, "cockpit");
  assert.equal(cockpitOrgan.armingFlag, null);
  assert.equal(typeof cockpitOrgan.run, "function");
});

test("run() returns a well-formed OrganRunResult and never throws", async () => {
  // No network is required for the shape contract: against the live worker this likely
  // succeeds (ok:true), and with no network it returns an honest ok:false probe-failed
  // beat — both are valid OrganRunResult shapes. We assert the shape, never fabricate ok.
  const result = await cockpitOrgan.run({}, "2026-06-14T00:00:00Z");
  assert.equal(typeof result.ok, "boolean");
  assert.ok("outputRef" in result);
  assert.ok(result.outputRef === null || typeof result.outputRef === "string");
  assert.equal(typeof result.summary, "string");
  assert.ok(result.summary.length <= 300);
});

test("run() honestly fails (no fabricated ok) when the probe target is unreachable", async () => {
  // Point at a guaranteed-dead host: must be ok:false with a null outputRef and an honest summary.
  const result = await cockpitOrgan.run(
    { HARTOS_COCKPIT_URL: "http://127.0.0.1:1" } as NodeJS.ProcessEnv,
    "2026-06-14T00:00:00Z",
  );
  assert.equal(result.ok, false);
  assert.equal(result.outputRef, null);
  assert.equal(typeof result.summary, "string");
});
