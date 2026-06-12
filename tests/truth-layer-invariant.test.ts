import { test } from "node:test";
import assert from "node:assert/strict";

import { computeFleetVerdict, fleetHealthPercent } from "../src/truth-layer/truth-layer-api.js";
import { toTruthSnapshot } from "../src/truth-layer/truth-layer-persist.js";
import type { FleetLiveness } from "../src/sentinel/sentinel-liveness.js";

const NOW = "2026-06-12T10:00:00.000Z";

function fleet(overall: FleetLiveness["overall"], counts: FleetLiveness["counts"]): FleetLiveness {
  return { generatedAt: NOW, verdicts: [], counts, overall, overallReason: "invariant fixture" };
}

// The whole point of the truth layer: what a human is shown is COMPUTED from evidence, and the
// "ok" signal can never be a flattering lie. These invariants guard that contract.

test("INVARIANT: ok is true exactly when the fleet is not RED, across every overall state", () => {
  for (const overall of ["GREEN", "AMBER", "RED"] as const) {
    const counts = {
      up: 1,
      stale: 0,
      down: overall === "RED" ? 1 : 0,
      unknown: overall === "AMBER" ? 1 : 0,
      assessed: 2,
    };
    const report = computeFleetVerdict(fleet(overall, counts), {
      now: NOW,
      version: null,
      builtAt: null,
      armedFlags: [],
    });
    assert.equal(report.ok, overall !== "RED", `ok must reflect overall=${overall}, not assert true`);
  }
});

test("INVARIANT: a persisted snapshot agrees with the report it came from (no laundering)", () => {
  const report = computeFleetVerdict(fleet("RED", { up: 0, stale: 0, down: 2, unknown: 0, assessed: 2 }), {
    now: NOW,
    version: "abc1234",
    builtAt: null,
    armedFlags: [],
  });
  const snap = toTruthSnapshot(report);

  assert.equal(snap.ok, report.ok);
  assert.equal(snap.overall, report.fleet.overall);
  assert.equal(snap.version, report.version);
  assert.equal(snap.healthPercent, fleetHealthPercent(report.fleet));
});

test("INVARIANT: fleetHealthPercent stays within 0..100 and is 0 when nothing is assessed", () => {
  const cases: FleetLiveness["counts"][] = [
    { up: 0, stale: 0, down: 0, unknown: 0, assessed: 0 },
    { up: 3, stale: 1, down: 1, unknown: 2, assessed: 7 },
    { up: 5, stale: 0, down: 0, unknown: 0, assessed: 5 },
  ];
  for (const c of cases) {
    const pct = fleetHealthPercent(fleet("GREEN", c));
    assert.ok(pct >= 0 && pct <= 100, `pct in 0..100 for ${JSON.stringify(c)}`);
  }
  assert.equal(fleetHealthPercent(fleet("GREEN", { up: 0, stale: 0, down: 0, unknown: 0, assessed: 0 })), 0);
});
