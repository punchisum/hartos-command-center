/**
 * tests/release-compare.test.ts
 *
 * Tests for the release comparison utility.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compareReleases, formatReleaseComparison } from "../src/launch/release-compare.js";

let tmpDir: string;

before(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "hartos-release-compare-test-"));
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("compareReleases — no reports", () => {
  test("no launch reports → returns null current", async () => {
    const reportsDir = path.join(tmpDir, "empty");
    const result = await compareReleases(reportsDir);
    assert.equal(result.current, null);
  });

  test("handles missing directory gracefully", async () => {
    const result = await compareReleases(path.join(tmpDir, "nonexistent"));
    assert.equal(result.current, null);
    assert.deepEqual(result.changes, []);
  });
});

describe("compareReleases — single report", () => {
  test("one report → current set, baseline null, no changes", async () => {
    const reportsDir = path.join(tmpDir, "single");
    await mkdir(reportsDir, { recursive: true });
    await writeFile(
      path.join(reportsDir, "staging-launch-2026-06-03T10-00-00.json"),
      JSON.stringify({
        launchStatus: "success",
        timestamp: "2026-06-03T10:00:00.000Z",
        smokeResult: "passed",
        manualRequiredSteps: [],
      }),
      "utf8"
    );
    const result = await compareReleases(reportsDir);
    assert.ok(result.current !== null);
    assert.equal(result.baseline, null);
    assert.deepEqual(result.changes, []);
  });
});

describe("compareReleases — two reports", () => {
  test("detects status change", async () => {
    const reportsDir = path.join(tmpDir, "status-change");
    await mkdir(reportsDir, { recursive: true });
    await writeFile(
      path.join(reportsDir, "staging-launch-2026-06-01T10-00-00.json"),
      JSON.stringify({ launchStatus: "partial", timestamp: "2026-06-01T10:00:00.000Z", smokeResult: "failed", manualRequiredSteps: [] }),
      "utf8"
    );
    await writeFile(
      path.join(reportsDir, "staging-launch-2026-06-03T10-00-00.json"),
      JSON.stringify({ launchStatus: "success", timestamp: "2026-06-03T10:00:00.000Z", smokeResult: "passed", manualRequiredSteps: [] }),
      "utf8"
    );
    const result = await compareReleases(reportsDir);
    assert.ok(result.changes.some((c) => c.type === "status_changed"));
    assert.ok(result.changes.some((c) => c.description.includes("partial") && c.description.includes("success")));
  });

  test("detects new manual_required step", async () => {
    const reportsDir = path.join(tmpDir, "new-manual");
    await mkdir(reportsDir, { recursive: true });
    await writeFile(
      path.join(reportsDir, "staging-launch-2026-06-01T10-00-00.json"),
      JSON.stringify({ launchStatus: "success", timestamp: "2026-06-01T10:00:00.000Z", smokeResult: "passed", manualRequiredSteps: [] }),
      "utf8"
    );
    await writeFile(
      path.join(reportsDir, "staging-launch-2026-06-03T10-00-00.json"),
      JSON.stringify({ launchStatus: "partial", timestamp: "2026-06-03T10:00:00.000Z", smokeResult: "passed", manualRequiredSteps: ["provision:supabase:apply_migrations"] }),
      "utf8"
    );
    const result = await compareReleases(reportsDir);
    assert.ok(result.changes.some((c) => c.type === "new_manual_required"));
  });

  test("detects resolved manual_required step", async () => {
    const reportsDir = path.join(tmpDir, "resolved-manual");
    await mkdir(reportsDir, { recursive: true });
    await writeFile(
      path.join(reportsDir, "staging-launch-2026-06-01T10-00-00.json"),
      JSON.stringify({ launchStatus: "partial", timestamp: "2026-06-01T10:00:00.000Z", smokeResult: "passed", manualRequiredSteps: ["provision:supabase:apply_migrations"] }),
      "utf8"
    );
    await writeFile(
      path.join(reportsDir, "staging-launch-2026-06-03T10-00-00.json"),
      JSON.stringify({ launchStatus: "success", timestamp: "2026-06-03T10:00:00.000Z", smokeResult: "passed", manualRequiredSteps: [] }),
      "utf8"
    );
    const result = await compareReleases(reportsDir);
    assert.ok(result.changes.some((c) => c.type === "resolved_manual_required"));
  });

  test("no changes when reports are identical", async () => {
    const reportsDir = path.join(tmpDir, "identical");
    await mkdir(reportsDir, { recursive: true });
    const sameReport = { launchStatus: "success", timestamp: "2026-06-01T10:00:00.000Z", smokeResult: "passed", manualRequiredSteps: [] };
    await writeFile(path.join(reportsDir, "staging-launch-2026-06-01T10-00-00.json"), JSON.stringify(sameReport), "utf8");
    await writeFile(path.join(reportsDir, "staging-launch-2026-06-03T10-00-00.json"), JSON.stringify({ ...sameReport, timestamp: "2026-06-03T10:00:00.000Z" }), "utf8");
    const result = await compareReleases(reportsDir);
    assert.deepEqual(result.changes, []);
  });
});

describe("formatReleaseComparison", () => {
  test("includes summary", async () => {
    const reportsDir = path.join(tmpDir, "format-test");
    const comparison = await compareReleases(reportsDir);
    const formatted = formatReleaseComparison(comparison);
    assert.ok(formatted.includes("Release Comparison"));
    assert.ok(typeof formatted === "string");
  });

  test("does not contain secrets", async () => {
    const reportsDir = path.join(tmpDir, "format-safe");
    const comparison = await compareReleases(reportsDir);
    const formatted = formatReleaseComparison(comparison);
    const secretPattern = /[A-Za-z0-9+/=_-]{40,}/;
    assert.ok(!secretPattern.test(formatted), "Comparison must not contain secret-like values");
  });
});
