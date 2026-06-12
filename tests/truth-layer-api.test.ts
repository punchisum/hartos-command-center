import { test } from "node:test";
import assert from "node:assert/strict";

import { computeFleetVerdict } from "../src/truth-layer/truth-layer-api.js";
import type { FleetLiveness } from "../src/sentinel/sentinel-liveness.js";

function fleet(overall: FleetLiveness["overall"]): FleetLiveness {
  return {
    generatedAt: "2026-06-12T10:00:00.000Z",
    verdicts: [],
    counts: { up: 0, stale: 0, down: overall === "RED" ? 1 : 0, unknown: 0, assessed: 1 },
    overall,
    overallReason: "fixture",
  };
}

const META = {
  now: "2026-06-12T10:00:00.000Z",
  version: "68179d9",
  builtAt: "2026-06-12T09:00:00.000Z",
  armedFlags: [{ name: "HARTOS_LLM_ENABLE_NETWORK", present: true }],
};

// The audit's core lie was GET /health returning ok:true ALWAYS. The truth layer must
// compute ok from real fleet evidence — false the moment something is hard-down.
test("computeFleetVerdict reports ok=false when the fleet is RED", () => {
  const report = computeFleetVerdict(fleet("RED"), META);
  assert.equal(report.ok, false);
});

test("computeFleetVerdict reports ok=true when the fleet is GREEN", () => {
  const report = computeFleetVerdict(fleet("GREEN"), META);
  assert.equal(report.ok, true);
});

test("computeFleetVerdict surfaces the deployed SHA and build time", () => {
  const report = computeFleetVerdict(fleet("GREEN"), META);
  assert.equal(report.version, "68179d9");
  assert.equal(report.builtAt, "2026-06-12T09:00:00.000Z");
});

test("computeFleetVerdict carries armed flags as presence-only, never values", () => {
  const report = computeFleetVerdict(fleet("GREEN"), META);
  assert.deepEqual(report.armedFlags, [{ name: "HARTOS_LLM_ENABLE_NETWORK", present: true }]);
  assert.equal(JSON.stringify(report.armedFlags).includes("value"), false);
});
