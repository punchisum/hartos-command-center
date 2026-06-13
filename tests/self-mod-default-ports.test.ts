/**
 * tests/self-mod-default-ports.test.ts — P6: the real ports' arming contract (disarmed by default).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  selfModArmingFromEnv,
  changedFileContent,
  defaultSelfModPorts,
  SELFMOD_AMENDMENT_ENV,
  SELFMOD_CLASS_FLAG_ENV,
  KILL_SWITCH_ENV,
} from "../src/execution/self-mod-default-ports.js";

describe("selfModArmingFromEnv (the arming contract)", () => {
  it("disarmed by default (no flags)", () => {
    assert.equal(selfModArmingFromEnv({}), false);
  });
  it("disarmed with only the amendment approved", () => {
    assert.equal(selfModArmingFromEnv({ [SELFMOD_AMENDMENT_ENV]: "true" }), false);
  });
  it("disarmed with only the class flag armed", () => {
    assert.equal(selfModArmingFromEnv({ [SELFMOD_CLASS_FLAG_ENV]: "true" }), false);
  });
  it("ARMED only when amendment AND class flag set and kill-switch off", () => {
    assert.equal(selfModArmingFromEnv({ [SELFMOD_AMENDMENT_ENV]: "true", [SELFMOD_CLASS_FLAG_ENV]: "true" }), true);
  });
  it("kill-switch ON disarms even when both are set", () => {
    assert.equal(
      selfModArmingFromEnv({ [SELFMOD_AMENDMENT_ENV]: "true", [SELFMOD_CLASS_FLAG_ENV]: "true", [KILL_SWITCH_ENV]: "on" }),
      false,
    );
  });
  it("exact-match: truthy-but-not-'true' values do NOT arm (fail-closed)", () => {
    assert.equal(selfModArmingFromEnv({ [SELFMOD_AMENDMENT_ENV]: "1", [SELFMOD_CLASS_FLAG_ENV]: "yes" }), false);
  });
});

describe("changedFileContent", () => {
  it("returns '' for a non-existent path (never throws)", () => {
    assert.equal(changedFileContent(process.cwd(), ["does/not/exist-xyz-123.ts"]), "");
  });
});

describe("defaultSelfModPorts", () => {
  it("is disarmed by default — isArmed() false with empty env", () => {
    const ports = defaultSelfModPorts("some approved task", process.cwd(), {});
    assert.equal(ports.isArmed(), false);
  });
});
