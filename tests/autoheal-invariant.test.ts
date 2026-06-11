/**
 * tests/autoheal-invariant.test.ts — "ONE GATE, NOT TWO" drift guard.
 *
 * The decision engine (brain) and the autoheal-gate (hands) must agree EXACTLY on which actions may
 * auto-execute unattended. This test fails the build if the pure invariant ever drifts from the
 * actual armed autoheal classes, or if an external adapter ever sneaks into an autoheal class.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AUTOHEAL_ELIGIBLE_ADAPTER_IDS,
  AUTOHEAL_CLASS_FLAG,
  isAutohealEligible,
} from "../src/doctrine/autoheal-invariant.js";
import { AUTOHEAL_CLASSES, AUTOHEAL_PROPOSAL_HYGIENE_FLAG } from "../src/doctrine/autoheal-gate.js";
import { PROPOSAL_TIER_BY_AUTONOMY } from "../src/cockpit/decision-engine.js";

// Adapters that touch an external system — must NEVER be autoheal-eligible.
const EXTERNAL_ADAPTER_IDS = ["clickup-comment", "clickup-move-status", "mark-reviewed"];

describe("autoheal invariant — single source of truth", () => {
  it("the invariant's eligible ids exactly equal the autoheal-gate's class adapter ids", () => {
    const gateIds = AUTOHEAL_CLASSES.flatMap((c) => c.adapters.map((a) => a.id)).sort();
    const invariantIds = [...AUTOHEAL_ELIGIBLE_ADAPTER_IDS].sort();
    assert.deepEqual(invariantIds, gateIds, "brain and gate must list the same auto-executable adapters");
  });

  it("no external adapter is ever autoheal-eligible (internal + reversible only)", () => {
    for (const ext of EXTERNAL_ADAPTER_IDS) {
      assert.equal(isAutohealEligible(ext), false, `${ext} must never auto-execute unattended`);
    }
  });

  it("the class flag matches the gate's flag", () => {
    assert.equal(AUTOHEAL_CLASS_FLAG, AUTOHEAL_PROPOSAL_HYGIENE_FLAG);
  });
});

describe("autonomy ↔ proposal-tier bridge is risk-ordered and total", () => {
  it("maps every autonomy tier to a payload tier, low→high", () => {
    assert.equal(PROPOSAL_TIER_BY_AUTONOMY.auto, "T0");
    assert.equal(PROPOSAL_TIER_BY_AUTONOMY.trusted, "T1");
    assert.equal(PROPOSAL_TIER_BY_AUTONOMY.one_click, "T2");
    assert.equal(PROPOSAL_TIER_BY_AUTONOMY.explicit, "T3");
    assert.equal(PROPOSAL_TIER_BY_AUTONOMY.human_only, "T4");
  });
});
