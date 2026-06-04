/**
 * tests/production-readiness.test.ts
 *
 * Tests for production readiness checks.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkProductionReadiness } from "../src/launch/production-readiness.js";

let tmpDir: string;

before(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "hartos-prod-readiness-test-"));
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("checkProductionReadiness", () => {
  test("empty env → all gates missing", async () => {
    const result = await checkProductionReadiness({}, tmpDir);
    assert.ok(result.missingGates.includes("ALLOW_PRODUCTION_PROMOTION"));
    assert.ok(result.missingGates.includes("CONFIRM_PRODUCTION_DEPLOY"));
    assert.ok(result.missingGates.includes("ALLOW_AUTO_PROVISION"));
  });

  test("no staging proof → shown as not ready", async () => {
    const result = await checkProductionReadiness({}, tmpDir);
    const stagingCheck = result.checks.find((c) => c.name === "staging:proof");
    assert.ok(stagingCheck?.ok === false);
  });

  test("staging proof exists and is green → staging check passes", async () => {
    const reportsDir = path.join(tmpDir, "green-proof");
    await mkdir(reportsDir, { recursive: true });
    await writeFile(
      path.join(reportsDir, "staging-launch-2026-06-03T10-00-00.json"),
      JSON.stringify({ launchStatus: "success", timestamp: "2026-06-03T10:00:00.000Z" }),
      "utf8"
    );
    // root = reportsDir's parent because checkProductionReadiness looks for launch-reports/ under root
    // We need to put it at the right path
    const fakeRoot = path.join(tmpDir, "fake-root-green");
    const fakeLaunchReports = path.join(fakeRoot, "launch-reports");
    await mkdir(fakeLaunchReports, { recursive: true });
    await writeFile(
      path.join(fakeLaunchReports, "staging-launch-2026-06-03T10-00-00.json"),
      JSON.stringify({ launchStatus: "success", timestamp: "2026-06-03T10:00:00.000Z" }),
      "utf8"
    );
    const result = await checkProductionReadiness({}, fakeRoot);
    const stagingCheck = result.checks.find((c) => c.name === "staging:proof");
    assert.ok(stagingCheck?.ok === true);
  });

  test("returns checks with expected categories", async () => {
    const result = await checkProductionReadiness({}, tmpDir);
    const names = result.checks.map((c) => c.name);
    assert.ok(names.some((n) => n.startsWith("gate:")));
    assert.ok(names.some((n) => n.startsWith("provider:")));
    assert.ok(names.includes("staging:proof"));
    assert.ok(names.includes("production:confirmed"));
  });

  test("CONFIRM_PRODUCTION_DEPLOY=true shows as confirmed", async () => {
    const result = await checkProductionReadiness({ CONFIRM_PRODUCTION_DEPLOY: "true" }, tmpDir);
    const confirmedCheck = result.checks.find((c) => c.name === "production:confirmed");
    assert.ok(confirmedCheck?.ok === true);
  });
});
