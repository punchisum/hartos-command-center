/**
 * tests/self-mod-drift.test.ts
 *
 * P6 §6 — self-mod guardrail drift detector tests.
 *
 * The guards are currently intact, so detectSelfModDrift must return [] today.
 * If a future change weakens a guard, the detector (not this test) fires the finding.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectSelfModDrift, SELF_MOD_DRIFT_DETECTOR } from "../src/wolverine/detectors/self-mod-drift.js";
import { DEFAULT_DETECTORS } from "../src/wolverine/wolverine-audit.js";
import type { WolverineInputs } from "../src/wolverine/wolverine-types.js";

const NOW = "2026-06-14T00:00:00.000Z";

/** Minimal valid WolverineInputs — the detector ignores everything except `now`. */
const MINIMAL_INPUTS: WolverineInputs = { now: NOW };

describe("detectSelfModDrift", () => {
  it("returns an array (structural contract)", () => {
    const result = detectSelfModDrift(MINIMAL_INPUTS);
    assert.ok(Array.isArray(result), "detectSelfModDrift must return an array");
  });

  it("returns [] when all guardrails are intact (the happy path — no drift today)", () => {
    // Intactness ⇒ []:
    //   • isInSelfModScope returns allowed:false for every GUARDRAIL_PATH
    //   • isSelfModArmed({false,false,false}) returns false  (fail-closed)
    //   • isSelfModArmed({true,true,true})   returns false  (kill-switch dominates)
    const findings = detectSelfModDrift(MINIMAL_INPUTS);
    assert.deepEqual(findings, [], "expected no findings when guardrails are intact");
  });

  it("is registered in DEFAULT_DETECTORS", () => {
    assert.ok(
      DEFAULT_DETECTORS.includes(detectSelfModDrift),
      "detectSelfModDrift must appear in DEFAULT_DETECTORS (wolverine-audit.ts)",
    );
  });

  it("exports the stable detector id SELF_MOD_DRIFT_DETECTOR", () => {
    assert.equal(SELF_MOD_DRIFT_DETECTOR, "self-mod-drift");
  });

  it("all findings (if any) carry the correct source id", () => {
    // Currently returns [] — but if drift were ever present the source must be stable.
    const findings = detectSelfModDrift(MINIMAL_INPUTS);
    for (const f of findings) {
      assert.equal(f.source, SELF_MOD_DRIFT_DETECTOR, `finding ${f.id} must carry source="${SELF_MOD_DRIFT_DETECTOR}"`);
    }
  });
});
