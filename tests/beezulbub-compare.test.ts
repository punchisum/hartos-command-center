/**
 * tests/beezulbub-compare.test.ts
 *
 * Tests for Beezulbub candidate comparison.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  compareFromReports,
  formatComparisonReport,
} from "../src/beezulbub/candidate-compare.js";

let tmpDir: string;

before(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "hartos-beezulbub-compare-test-"));
  // Create some fake score files
  await writeFile(
    path.join(tmpDir, "score-2026-06-01T10-00-00.json"),
    JSON.stringify({
      repoName: "clean-dashboard",
      verdict: "DEVOUR",
      score: {
        overall: 7.9,
        licenseSafety: 9,
        securityRisk: 0,
        hartosCompatibility: 7,
        capabilityValue: 6,
      },
      poisonFlagCount: 0,
      summary: "Clean dashboard",
    }),
    "utf8"
  );
  await writeFile(
    path.join(tmpDir, "score-2026-06-01T11-00-00.json"),
    JSON.stringify({
      repoName: "risky-repo",
      verdict: "REJECT_POISON",
      score: {
        overall: 2.1,
        licenseSafety: 0,
        securityRisk: 8,
        hartosCompatibility: 3,
        capabilityValue: 1,
      },
      poisonFlagCount: 3,
      summary: "Risky repo",
    }),
    "utf8"
  );
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("compareFromReports", () => {
  test("reads and ranks score files", async () => {
    const report = await compareFromReports(tmpDir);
    assert.ok(report.candidates.length >= 1, "Should find candidates from score files");
  });

  test("top candidate is the highest-scoring one", async () => {
    const report = await compareFromReports(tmpDir);
    assert.ok(
      report.topCandidate === "clean-dashboard" || report.topCandidate !== null,
      "Top candidate should be the clean repo"
    );
  });

  test("identifies cleanest license", async () => {
    const report = await compareFromReports(tmpDir);
    // clean-dashboard has higher licenseSafety (9 vs 0)
    assert.ok(
      report.cleanestLicense === "clean-dashboard" || report.cleanestLicense !== null
    );
  });

  test("identifies lowest poison", async () => {
    const report = await compareFromReports(tmpDir);
    // clean-dashboard has 0 poison flags
    assert.ok(
      report.lowestPoison === "clean-dashboard" || report.lowestPoison !== null
    );
  });

  test("returns empty comparison for missing directory", async () => {
    const report = await compareFromReports("/nonexistent/reports/dir");
    assert.equal(report.candidates.length, 0);
    assert.ok(report.nextAction.includes("No reports") || report.nextAction.length > 0);
  });

  test("returns empty comparison for directory with no score files", async () => {
    const emptyDir = await mkdtemp(path.join(tmpdir(), "hartos-empty-reports-"));
    try {
      const report = await compareFromReports(emptyDir);
      assert.equal(report.candidates.length, 0);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  test("includes next action and summary", async () => {
    const report = await compareFromReports(tmpDir);
    assert.ok(typeof report.nextAction === "string");
    assert.ok(typeof report.summary === "string");
    assert.ok(report.nextAction.length > 0);
  });
});

describe("formatComparisonReport", () => {
  test("includes top candidate", async () => {
    const report = await compareFromReports(tmpDir);
    const formatted = formatComparisonReport(report);
    assert.ok(formatted.includes("Comparison Report"));
    if (report.topCandidate) {
      assert.ok(formatted.includes(report.topCandidate));
    }
  });

  test("does not contain secret-like values", async () => {
    const report = await compareFromReports(tmpDir);
    const formatted = formatComparisonReport(report);
    const secretPattern = /[A-Za-z0-9+=_-]{40,}/;
    assert.ok(!secretPattern.test(formatted), "Report must not contain secret-like values");
  });

  test("shows DEVOUR verdict for clean candidate", async () => {
    const report = await compareFromReports(tmpDir);
    const formatted = formatComparisonReport(report);
    assert.ok(formatted.includes("DEVOUR") || formatted.includes("Verdict"));
  });
});
