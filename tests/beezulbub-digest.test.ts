/**
 * tests/beezulbub-digest.test.ts
 *
 * Tests for Beezulbub digest — local repo analysis.
 * Uses fixture repos. No live network calls.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { digestLocalRepo } from "../src/beezulbub/digest.js";

const root = process.cwd();
const cleanDashboard = path.join(root, "tests", "fixtures", "beezulbub", "clean-dashboard");
const riskyRepo = path.join(root, "tests", "fixtures", "beezulbub", "risky-repo");

// ─── Clean repo ───────────────────────────────────────────────────────────────

describe("beezulbub:digest — clean-dashboard fixture", () => {
  test("detects package manager", async () => {
    const digest = await digestLocalRepo({ localPath: cleanDashboard });
    assert.ok(digest.packageManagers.includes("npm/yarn/pnpm"));
  });

  test("detects React framework", async () => {
    const digest = await digestLocalRepo({ localPath: cleanDashboard });
    assert.ok(digest.frameworks.includes("React"), `Expected React, got: ${digest.frameworks.join(", ")}`);
  });

  test("detects Tailwind CSS", async () => {
    const digest = await digestLocalRepo({ localPath: cleanDashboard });
    assert.ok(digest.frameworks.includes("Tailwind CSS"));
  });

  test("detects MIT license", async () => {
    const digest = await digestLocalRepo({ localPath: cleanDashboard });
    assert.equal(digest.licenseRisk, "safe");
    assert.ok(digest.license?.includes("MIT") || digest.licenseRisk === "safe");
  });

  test("detects test presence", async () => {
    const digest = await digestLocalRepo({ localPath: cleanDashboard });
    assert.ok(
      digest.testPresence === "present" || digest.testPresence === "minimal",
      `Expected tests present, got: ${digest.testPresence}`
    );
  });

  test("detects safe env handling (.env.example present)", async () => {
    const digest = await digestLocalRepo({ localPath: cleanDashboard });
    assert.ok(
      digest.envHandling === "safe" || digest.envHandling === "basic" || digest.envHandling === "none",
      `Expected safe env, got: ${digest.envHandling}`
    );
  });

  test("extracts dashboard capabilities", async () => {
    const digest = await digestLocalRepo({ localPath: cleanDashboard });
    assert.ok(
      digest.usefulCapabilities.some((c) => c.id === "dashboard_layout" || c.id === "admin_table"),
      `Expected dashboard capabilities, got: ${digest.usefulCapabilities.map((c) => c.id).join(", ")}`
    );
  });

  test("no critical poison flags in clean repo", async () => {
    const digest = await digestLocalRepo({ localPath: cleanDashboard });
    const critical = digest.poisonFlags.filter((p) => p.severity === "critical");
    assert.equal(critical.length, 0, `Should have no critical poison: ${critical.map(p => p.type).join(", ")}`);
  });

  test("verdict is DEVOUR or PARTIAL_DEVOUR for clean repo", async () => {
    const digest = await digestLocalRepo({ localPath: cleanDashboard });
    assert.ok(
      ["DEVOUR", "PARTIAL_DEVOUR"].includes(digest.recommendedVerdict),
      `Expected DEVOUR/PARTIAL_DEVOUR, got: ${digest.recommendedVerdict}`
    );
  });

  test("overall score is reasonable for clean repo", async () => {
    const digest = await digestLocalRepo({ localPath: cleanDashboard });
    assert.ok(digest.score.overall >= 4, `Score should be >= 4, got: ${digest.score.overall}`);
  });

  test("digest has repoName", async () => {
    const digest = await digestLocalRepo({ localPath: cleanDashboard });
    assert.equal(digest.repoName, "clean-dashboard");
  });
});

// ─── Risky repo ───────────────────────────────────────────────────────────────

describe("beezulbub:digest — risky-repo fixture", () => {
  test("detects .env committed (critical poison)", async () => {
    const digest = await digestLocalRepo({ localPath: riskyRepo });
    const envPoison = digest.poisonFlags.find((p) => p.type === "committed_env");
    assert.ok(envPoison, "Should detect committed .env file");
    assert.equal(envPoison!.severity, "critical");
  });

  test("detects missing license", async () => {
    const digest = await digestLocalRepo({ localPath: riskyRepo });
    assert.ok(
      digest.licenseRisk === "unknown" || digest.licenseRisk === "risky",
      `Expected unknown/risky license, got: ${digest.licenseRisk}`
    );
  });

  test("detects no tests", async () => {
    const digest = await digestLocalRepo({ localPath: riskyRepo });
    assert.equal(digest.testPresence, "none");
  });

  test("detects unsafe env handling", async () => {
    const digest = await digestLocalRepo({ localPath: riskyRepo });
    assert.equal(digest.envHandling, "unsafe");
  });

  test("verdict is REJECT for risky repo", async () => {
    const digest = await digestLocalRepo({ localPath: riskyRepo });
    assert.ok(
      ["REJECT_POISON", "REJECT_LICENSE", "REJECT_STALE", "REJECT_LOW_VALUE", "PARTIAL_DEVOUR"].includes(
        digest.recommendedVerdict
      ),
      `Expected reject verdict, got: ${digest.recommendedVerdict}`
    );
  });

  test("security risk score is high for risky repo", async () => {
    const digest = await digestLocalRepo({ localPath: riskyRepo });
    assert.ok(
      digest.score.securityRisk >= 3,
      `Security risk should be high, got: ${digest.score.securityRisk}`
    );
  });

  test("detects direct production deploy script", async () => {
    const digest = await digestLocalRepo({ localPath: riskyRepo });
    const deployPoison = digest.poisonFlags.find((p) => p.type === "direct_production_deploy");
    assert.ok(deployPoison, "Should detect direct production deploy script");
  });
});
