import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeFleetVerdict,
  assembleTruthReport,
  fleetHealthPercent,
} from "../src/truth-layer/truth-layer-api.js";
import type { FleetLiveness } from "../src/sentinel/sentinel-liveness.js";
import { resolveMetaAgentRegistry } from "../src/agents/meta-agent-registry.js";

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

test("assembleTruthReport marks the answering Worker up and stays ok when nothing is down", () => {
  const now = "2026-06-12T10:00:00.000Z";
  const registry = resolveMetaAgentRegistry({ now });

  const report = assembleTruthReport(
    registry,
    { enabledSources: [], staleSources: [] },
    null,
    now,
    { version: "abc1234", builtAt: null, armedFlags: [] },
  );

  assert.equal(report.version, "abc1234");
  const cockpit = report.fleet.verdicts.find((v) => v.agentId === "cockpit");
  assert.ok(cockpit, "cockpit verdict present");
  assert.equal(cockpit.state, "up"); // the Worker is answering ⇒ fresh self-evidence
  assert.equal(report.ok, true); // other agents are 'unknown' (AMBER), not down ⇒ still ok
});

function fleetWithCounts(c: FleetLiveness["counts"]): FleetLiveness {
  return {
    generatedAt: "2026-06-12T10:00:00.000Z",
    verdicts: [],
    counts: c,
    overall: c.down > 0 ? "RED" : c.stale > 0 || c.unknown > 0 ? "AMBER" : "GREEN",
    overallReason: "fixture",
  };
}

test("fleetHealthPercent is the share of assessed capabilities with fresh evidence", () => {
  const pct = fleetHealthPercent(fleetWithCounts({ up: 2, stale: 1, down: 0, unknown: 1, assessed: 4 }));
  assert.equal(pct, 50);
});

test("fleetHealthPercent is 0 when nothing is assessed (honest, never a default 100)", () => {
  const pct = fleetHealthPercent(fleetWithCounts({ up: 0, stale: 0, down: 0, unknown: 0, assessed: 0 }));
  assert.equal(pct, 0);
});
