/**
 * tests/wolverine-v2-detectors.test.ts — Wolverine v2 detectors (stale-read-model, doctrine-drift).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { detectStaleReadModel } from "../src/wolverine/detectors/stale-read-model.js";
import { detectDoctrineDrift } from "../src/wolverine/detectors/doctrine-drift.js";
import type { WolverineInputs } from "../src/wolverine/wolverine-types.js";

const NOW = "2026-06-10T00:00:00.000Z";
const base = (over: Partial<WolverineInputs> = {}): WolverineInputs => ({ now: NOW, env: {}, ...over });

describe("detectStaleReadModel", () => {
  it("flags each stale source as stale_data", () => {
    const f = detectStaleReadModel(base({ staleSources: ["ops", "fitness"] }));
    assert.equal(f.length, 2);
    assert.ok(f.every((x) => x.category === "stale_data"));
    assert.ok(f.some((x) => x.id === "stale-read-model:ops"));
  });
  it("returns nothing when no stale sources", () => {
    assert.equal(detectStaleReadModel(base()).length, 0);
    assert.equal(detectStaleReadModel(base({ staleSources: [] })).length, 0);
  });
});

describe("detectDoctrineDrift", () => {
  it("flags (high) when >=2 exec flags are armed", () => {
    const f = detectDoctrineDrift(base({ env: { ALLOW_EXEC_CLICKUP_COMMENT: "true", ALLOW_EXEC_REFRESH_SYNC: "true" } }));
    assert.equal(f.length, 1);
    assert.equal(f[0]!.severity, "high");
    assert.equal(f[0]!.category, "doctrine_drift");
  });
  it("returns nothing with 0 or 1 armed", () => {
    assert.equal(detectDoctrineDrift(base({ env: {} })).length, 0);
    assert.equal(detectDoctrineDrift(base({ env: { ALLOW_EXEC_CLICKUP_COMMENT: "true" } })).length, 0);
  });
});
