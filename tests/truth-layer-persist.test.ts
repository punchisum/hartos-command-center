import { test } from "node:test";
import assert from "node:assert/strict";

import { toTruthSnapshot } from "../src/truth-layer/truth-layer-persist.js";
import type { TruthLayerReport } from "../src/truth-layer/truth-layer-api.js";
import type { FleetLiveness } from "../src/sentinel/sentinel-liveness.js";

function report(overall: FleetLiveness["overall"], counts: FleetLiveness["counts"]): TruthLayerReport {
  return {
    ok: overall !== "RED",
    computedAt: "2026-06-12T10:00:00.000Z",
    version: "deadbee",
    builtAt: null,
    fleet: { generatedAt: "2026-06-12T10:00:00.000Z", verdicts: [], counts, overall, overallReason: "fx" },
    armedFlags: [],
  };
}

test("toTruthSnapshot flattens a report into an append-only record with computed health", () => {
  const snap = toTruthSnapshot(report("AMBER", { up: 1, stale: 0, down: 0, unknown: 1, assessed: 2 }));
  assert.equal(snap.capturedAt, "2026-06-12T10:00:00.000Z");
  assert.equal(snap.ok, true);
  assert.equal(snap.overall, "AMBER");
  assert.equal(snap.version, "deadbee");
  assert.equal(snap.healthPercent, 50); // 1 up / 2 assessed
  assert.equal(snap.assessed, 2);
});

test("toTruthSnapshot records ok=false and overall RED honestly", () => {
  const snap = toTruthSnapshot(report("RED", { up: 0, stale: 0, down: 1, unknown: 0, assessed: 1 }));
  assert.equal(snap.ok, false);
  assert.equal(snap.overall, "RED");
  assert.equal(snap.healthPercent, 0);
});
