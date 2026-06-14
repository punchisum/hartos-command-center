/**
 * tests/self-mod-default-ports.test.ts — P6: the real ports' arming contract (disarmed by default).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  selfModArmingFromEnv,
  changedFileContent,
  defaultSelfModPorts,
  envFileKeys,
  stripEnvKeys,
  hermeticTestEnv,
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

// The self-mod test gate must run HERMETICALLY (CI-like), not under the daemon's live .env.local — else
// production flags/secrets fail tests that assume an offline/unconfigured default and force a spurious rollback.
describe("envFileKeys / stripEnvKeys / hermeticTestEnv", () => {
  it("envFileKeys parses keys, ignoring comments + blanks + values", () => {
    const dir = mkdtempSync(join(tmpdir(), "hartos-env-"));
    try {
      writeFileSync(
        join(dir, ".env.local"),
        "# a comment\nHARTOS_ALLOW_SELF_MOD=true\n\nBEEZULBUB_ALLOW_NETWORK=1\nWEIRD=a=b=c\n  # indented comment\nexport EXPORTED=v\nSPACED =y\nNO_EQUALS_LINE\n",
      );
      assert.deepEqual(
        envFileKeys(join(dir, ".env.local")).sort(),
        ["BEEZULBUB_ALLOW_NETWORK", "EXPORTED", "HARTOS_ALLOW_SELF_MOD", "SPACED", "WEIRD"],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("envFileKeys → [] for a missing file (never throws)", () => {
    assert.deepEqual(envFileKeys(join(tmpdir(), "no-such-env-file-xyz-123")), []);
  });

  it("stripEnvKeys drops listed keys, keeps the rest (e.g. OS env like PATH)", () => {
    const base = { PATH: "/usr/bin", HARTOS_ALLOW_SELF_MOD: "true", BEEZULBUB_ALLOW_NETWORK: "1" };
    const out = stripEnvKeys(base, ["HARTOS_ALLOW_SELF_MOD", "BEEZULBUB_ALLOW_NETWORK"]);
    assert.deepEqual(out, { PATH: "/usr/bin" });
  });

  it("hermeticTestEnv strips exactly the .env.local-injected keys, preserving OS env", () => {
    const dir = mkdtempSync(join(tmpdir(), "hartos-env-"));
    try {
      writeFileSync(join(dir, ".env.local"), "HARTOS_ALLOW_SELF_MOD=true\nBEEZULBUB_ALLOW_NETWORK=1\n");
      const base = { PATH: "/usr/bin", HARTOS_ALLOW_SELF_MOD: "true", BEEZULBUB_ALLOW_NETWORK: "1", SystemRoot: "C:\\Windows" };
      const out = hermeticTestEnv(dir, base);
      assert.equal(out["HARTOS_ALLOW_SELF_MOD"], undefined, "injected flag must be stripped");
      assert.equal(out["BEEZULBUB_ALLOW_NETWORK"], undefined, "injected flag must be stripped");
      assert.equal(out["PATH"], "/usr/bin", "OS env preserved so npm/node still run");
      assert.equal(out["SystemRoot"], "C:\\Windows", "OS env preserved");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
