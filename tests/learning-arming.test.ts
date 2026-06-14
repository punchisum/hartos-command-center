import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { learningArmedFromEnv } from "../src/learning/learning-arming.js";

describe("learningArmedFromEnv", () => {
  it("disarmed by default", () => assert.equal(learningArmedFromEnv({}), false));
  it("armed only with HARTOS_ALLOW_LEARNING=true and kill-switch off", () => {
    assert.equal(learningArmedFromEnv({ HARTOS_ALLOW_LEARNING: "true" }), true);
  });
  it("kill-switch ON disarms even when allowed", () => {
    assert.equal(learningArmedFromEnv({ HARTOS_ALLOW_LEARNING: "true", HARTOS_EXECUTION_KILL_SWITCH: "on" }), false);
  });
});
