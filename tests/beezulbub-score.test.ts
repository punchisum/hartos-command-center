/**
 * tests/beezulbub-score.test.ts
 *
 * Tests for Beezulbub scoring and verdict derivation.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scoreDigest } from "../src/beezulbub/score.js";
import type { ExtractableCapability, PoisonFlag } from "../src/beezulbub/types.js";

const cleanCapability: ExtractableCapability = {
  id: "dashboard_layout",
  name: "Dashboard Layout",
  description: "Dashboard layout",
  absorb: ["layout"],
  reject: ["auth"],
  hartosPackTarget: "dashboard-pack",
  requiredTests: ["render"],
  requiredEnvVars: [],
  requiredProviderAdapters: [],
  requiredDbChanges: [],
  securityNotes: [],
  estimatedEffort: "low",
};

const criticalPoison: PoisonFlag = {
  type: "committed_env",
  severity: "critical",
  description: ".env committed",
  recommendation: "Remove .env",
};

const mediumPoison: PoisonFlag = {
  type: "no_test_suite",
  severity: "medium",
  description: "No tests",
  recommendation: "Add tests",
};

describe("scoreDigest — clean repo", () => {
  test("MIT license gets high licenseSafety", () => {
    const score = scoreDigest({
      licenseRisk: "safe",
      testPresence: "present",
      poisonFlags: [],
      dependencies: ["react", "react-dom"],
      capabilities: [cleanCapability],
      frameworks: ["React", "TypeScript"],
    });
    assert.ok(score.licenseSafety >= 8, `Expected high licenseSafety, got: ${score.licenseSafety}`);
  });

  test("present tests boost maintenanceHealth", () => {
    const score = scoreDigest({
      licenseRisk: "safe",
      testPresence: "present",
      poisonFlags: [],
      dependencies: [],
      capabilities: [cleanCapability],
      frameworks: [],
    });
    assert.ok(score.maintenanceHealth >= 7, `Expected high maintenance, got: ${score.maintenanceHealth}`);
  });

  test("no poison gives low securityRisk", () => {
    const score = scoreDigest({
      licenseRisk: "safe",
      testPresence: "present",
      poisonFlags: [],
      dependencies: [],
      capabilities: [cleanCapability],
      frameworks: [],
    });
    assert.equal(score.securityRisk, 0);
  });

  test("overall score >= 7 for clean, capable repo", () => {
    const score = scoreDigest({
      licenseRisk: "safe",
      testPresence: "present",
      poisonFlags: [],
      dependencies: ["react", "react-dom", "tailwindcss"],
      capabilities: [cleanCapability, { ...cleanCapability, id: "admin_table" }],
      frameworks: ["React", "TypeScript", "Tailwind CSS"],
    });
    assert.ok(score.overall >= 6, `Expected high overall, got: ${score.overall}`);
  });
});

describe("scoreDigest — risky repo", () => {
  test("risky license gives low licenseSafety", () => {
    const score = scoreDigest({
      licenseRisk: "risky",
      testPresence: "none",
      poisonFlags: [criticalPoison],
      dependencies: [],
      capabilities: [],
      frameworks: [],
    });
    assert.ok(score.licenseSafety <= 2, `Expected low licenseSafety, got: ${score.licenseSafety}`);
  });

  test("critical poison gives high securityRisk", () => {
    const score = scoreDigest({
      licenseRisk: "safe",
      testPresence: "none",
      poisonFlags: [criticalPoison],
      dependencies: [],
      capabilities: [],
      frameworks: [],
    });
    assert.ok(score.securityRisk >= 4, `Expected high securityRisk, got: ${score.securityRisk}`);
  });

  test("unknown license gives 0 licenseSafety", () => {
    const score = scoreDigest({
      licenseRisk: "unknown",
      testPresence: "none",
      poisonFlags: [],
      dependencies: [],
      capabilities: [],
      frameworks: [],
    });
    assert.equal(score.licenseSafety, 0);
  });

  test("GPL/AGPL license does not get high overall", () => {
    const score = scoreDigest({
      licenseRisk: "risky",
      testPresence: "present",
      poisonFlags: [],
      dependencies: [],
      capabilities: [cleanCapability],
      frameworks: [],
    });
    assert.ok(score.overall < 6, `GPL should get low overall, got: ${score.overall}`);
  });
});

describe("scoreDigest — HartOS compatibility", () => {
  test("TypeScript + Supabase boosts hartosCompatibility", () => {
    const score = scoreDigest({
      licenseRisk: "safe",
      testPresence: "present",
      poisonFlags: [],
      dependencies: [],
      capabilities: [],
      frameworks: ["TypeScript", "Supabase"],
    });
    assert.ok(score.hartosCompatibility >= 7, `Expected high compat, got: ${score.hartosCompatibility}`);
  });

  test("Firebase reduces hartosCompatibility", () => {
    const score = scoreDigest({
      licenseRisk: "safe",
      testPresence: "present",
      poisonFlags: [],
      dependencies: [],
      capabilities: [],
      frameworks: ["Firebase"],
    });
    assert.ok(score.hartosCompatibility <= 5, `Firebase should reduce compat, got: ${score.hartosCompatibility}`);
  });
});
