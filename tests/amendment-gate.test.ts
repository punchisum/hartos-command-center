import { test } from "node:test";
import assert from "node:assert/strict";

import { isSelfModArmed } from "../src/doctrine/amendment-gate.js";

// Self-modification is the summit. It must DEFAULT TO REFUSING: armed only behind a formally
// approved Constitutional Amendment AND a distinct class flag AND with the kill switch off.
test("self-mod is NOT armed by default (no amendment, no flag)", () => {
  assert.equal(isSelfModArmed({ amendmentApproved: false, classFlagArmed: false, killSwitchOn: false }), false);
});

test("self-mod requires BOTH the constitutional amendment AND the class flag", () => {
  assert.equal(isSelfModArmed({ amendmentApproved: true, classFlagArmed: false, killSwitchOn: false }), false);
  assert.equal(isSelfModArmed({ amendmentApproved: false, classFlagArmed: true, killSwitchOn: false }), false);
  assert.equal(isSelfModArmed({ amendmentApproved: true, classFlagArmed: true, killSwitchOn: false }), true);
});

test("the kill switch overrides everything, even a full amendment + flag", () => {
  assert.equal(isSelfModArmed({ amendmentApproved: true, classFlagArmed: true, killSwitchOn: true }), false);
});
