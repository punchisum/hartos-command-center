import { test } from "node:test";
import assert from "node:assert/strict";
import { sentinelOrgan } from "../src/organs/adapters/sentinel.js";

test("sentinelOrgan is a well-formed armed adapter", () => {
  assert.equal(sentinelOrgan.organId, "sentinel");
  assert.equal(sentinelOrgan.armingFlag, "HARTOS_ALLOW_SENTINEL_WOLVERINE");
  assert.equal(typeof sentinelOrgan.run, "function");
});

test("run() returns a well-formed OrganRunResult and never throws", async () => {
  // The core (assessFleetLiveness) is PURE + needs no network, so this runs offline.
  const result = await sentinelOrgan.run({} as NodeJS.ProcessEnv, "2026-06-14T00:00:00Z");
  assert.equal(typeof result.ok, "boolean");
  assert.ok("outputRef" in result);
  assert.ok(result.outputRef === null || typeof result.outputRef === "string");
  assert.equal(typeof result.summary, "string");
  assert.ok(result.summary.length <= 300);
});

test("run() produces a real fleet verdict (ok:true) with a fleet:<verdict> handle", async () => {
  // Absence of heavy evidence is itself an honest verdict (AMBER/unknown), so the core returns a
  // verdict ⇒ ok:true. outputRef is a SOT-readable verdict handle, never a fabricated success.
  const result = await sentinelOrgan.run({} as NodeJS.ProcessEnv, "2026-06-14T00:00:00Z");
  assert.equal(result.ok, true);
  assert.ok(typeof result.outputRef === "string");
  assert.match(result.outputRef as string, /^fleet:(GREEN|AMBER|RED)$/);
  assert.match(result.summary, /fleet liveness/i);
});
