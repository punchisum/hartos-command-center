import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveFitnessAdjustment } from "../src/fitness/fitness-adjustment-rules.js";

// Autonomous fitness "acts on its own" — but the decision is DETERMINISTIC rules over the recovery
// verdict, never an LLM. These pin the safety-relevant calls.
test("deriveFitnessAdjustment defers a hard session on red (poor) recovery", () => {
  assert.equal(deriveFitnessAdjustment("red", "hard").action, "defer");
});

test("deriveFitnessAdjustment keeps a hard session as planned on green recovery and fuels it", () => {
  const a = deriveFitnessAdjustment("green", "hard");
  assert.equal(a.action, "as-planned");
  assert.ok(a.caloriePct > 0, "green + hard should add fuel");
});

test("deriveFitnessAdjustment downgrades to controlled on amber recovery", () => {
  assert.equal(deriveFitnessAdjustment("amber", "hard").action, "controlled");
});

test("deriveFitnessAdjustment never defers a rest day", () => {
  assert.equal(deriveFitnessAdjustment("red", "rest").action, "as-planned");
});
