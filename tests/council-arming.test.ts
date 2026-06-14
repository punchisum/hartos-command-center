import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { councilArmedFromEnv, COUNCIL_CAPS } from "../src/council/council-arming.js";

describe("councilArmedFromEnv", () => {
  it("disarmed by default", () => assert.equal(councilArmedFromEnv({}), false));
  it("armed only with HARTOS_ALLOW_COUNCIL=true and kill-switch off", () => {
    assert.equal(councilArmedFromEnv({ HARTOS_ALLOW_COUNCIL: "true" }), true);
  });
  it("kill-switch ON disarms even when allowed", () => {
    assert.equal(councilArmedFromEnv({ HARTOS_ALLOW_COUNCIL: "true", HARTOS_EXECUTION_KILL_SWITCH: "on" }), false);
  });
  it("non-'true' values do not arm (fail-closed)", () => {
    assert.equal(councilArmedFromEnv({ HARTOS_ALLOW_COUNCIL: "1" }), false);
  });
  it("caps have sane defaults", () => {
    assert.ok(COUNCIL_CAPS.maxDepth >= 1 && COUNCIL_CAPS.maxPanel >= 1 && COUNCIL_CAPS.maxLlmCalls >= 1);
  });
});
