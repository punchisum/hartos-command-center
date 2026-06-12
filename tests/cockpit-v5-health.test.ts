import { test } from "node:test";
import assert from "node:assert/strict";

import { buildCockpitV5Data, type V5SourceAgent } from "../src/runtime/cloudflare-cockpit-v5.js";

// The v5 "fleet health %" was derived from asserted catalog status (count of entries marked
// "live"). It must instead use the truth layer's computed liveness when provided.
test("buildCockpitV5Data uses liveHealthPct (real liveness) over the asserted status count", () => {
  const agents: V5SourceAgent[] = [
    { id: "ops", displayName: "Ops", role: "ops", status: "live" },
    { id: "prophet", displayName: "Prophet", role: "forecast", status: "live" },
  ];

  // The asserted computation over these "live" agents would report a high %; the truth-layer
  // value (25) must win.
  const data = buildCockpitV5Data(agents, undefined, {
    now: "2026-06-12T10:00:00.000Z",
    buildSha: null,
    liveHealthPct: 25,
  });

  assert.equal(data.fleetFitness, "25");
});

test("buildCockpitV5Data falls back to the asserted count when no liveHealthPct is given", () => {
  const data = buildCockpitV5Data([], undefined, {
    now: "2026-06-12T10:00:00.000Z",
    buildSha: null,
  });

  // No agents ⇒ live 0 / total 1 ⇒ 0 (unchanged legacy behavior).
  assert.equal(data.fleetFitness, "0");
});
