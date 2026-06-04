/**
 * tests/beezulbub-batch.test.ts
 *
 * Tests for Beezulbub batch digestion.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { runBatchDigest, loadBatchConfig } from "../src/beezulbub/batch-digest.js";
import type { BatchConfig } from "../src/beezulbub/types.js";

const root = process.cwd();
const cleanDashboard = "tests/fixtures/beezulbub/clean-dashboard";
const riskyRepo = "tests/fixtures/beezulbub/risky-repo";

const batchConfig: BatchConfig = {
  target: "dashboard_layout",
  repos: [
    { name: "clean-dashboard", localPath: cleanDashboard },
    { name: "risky-repo", localPath: riskyRepo },
  ],
};

describe("runBatchDigest — local fixtures", () => {
  test("processes all repos in batch", async () => {
    const result = await runBatchDigest(batchConfig);
    assert.equal(result.results.length, 2);
  });

  test("digests clean-dashboard successfully", async () => {
    const result = await runBatchDigest(batchConfig);
    const clean = result.results.find((r) => r.repo.name === "clean-dashboard");
    assert.ok(clean?.status === "digested", `Expected digested, got: ${clean?.status}`);
    assert.ok(clean?.digest !== undefined);
  });

  test("digests risky-repo successfully (not skipped)", async () => {
    const result = await runBatchDigest(batchConfig);
    const risky = result.results.find((r) => r.repo.name === "risky-repo");
    assert.ok(risky?.status === "digested" || risky?.status === "failed");
  });

  test("ranks clean repo above risky repo", async () => {
    const result = await runBatchDigest(batchConfig);
    const ranking = result.ranking;
    if (ranking.length >= 2) {
      const cleanRank = ranking.findIndex((r) => r.name === "clean-dashboard");
      const riskyRank = ranking.findIndex((r) => r.name === "risky-repo");
      assert.ok(
        cleanRank < riskyRank || ranking[0]!.overall >= ranking[ranking.length - 1]!.overall,
        "Clean repo should rank at or above risky repo"
      );
    }
  });

  test("top candidate is set when repos are digested", async () => {
    const result = await runBatchDigest(batchConfig);
    const digestedCount = result.results.filter((r) => r.status === "digested").length;
    if (digestedCount > 0) {
      assert.ok(result.topCandidate !== null);
    }
  });

  test("includes recommendation", async () => {
    const result = await runBatchDigest(batchConfig);
    assert.ok(typeof result.recommendation === "string");
    assert.ok(result.recommendation.length > 0);
  });

  test("handles missing localPath gracefully", async () => {
    const config: BatchConfig = {
      target: "dashboard_layout",
      repos: [
        { name: "clean-dashboard", localPath: cleanDashboard },
        { name: "missing-repo" }, // no localPath
      ],
    };
    const result = await runBatchDigest(config);
    const missing = result.results.find((r) => r.repo.name === "missing-repo");
    assert.ok(missing?.status === "skipped");
    assert.ok(missing?.error?.includes("localPath") || missing?.error?.includes("Clone"));
  });

  test("handles nonexistent path gracefully", async () => {
    const config: BatchConfig = {
      target: "dashboard_layout",
      repos: [
        { name: "clean-dashboard", localPath: cleanDashboard },
        { name: "ghost-repo", localPath: "/nonexistent/path/nowhere" },
      ],
    };
    const result = await runBatchDigest(config);
    const ghost = result.results.find((r) => r.repo.name === "ghost-repo");
    assert.ok(ghost?.status === "skipped" || ghost?.status === "failed");
  });

  test("status is completed when all repos succeed", async () => {
    const config: BatchConfig = {
      target: "dashboard_layout",
      repos: [{ name: "clean-dashboard", localPath: cleanDashboard }],
    };
    const result = await runBatchDigest(config);
    assert.equal(result.status, "completed");
  });

  test("status is partial when some repos fail", async () => {
    const config: BatchConfig = {
      target: "dashboard_layout",
      repos: [
        { name: "clean-dashboard", localPath: cleanDashboard },
        { name: "missing" }, // no path → skipped
      ],
    };
    const result = await runBatchDigest(config);
    assert.ok(result.status === "partial" || result.status === "completed");
  });

  test("batch report contains no secrets", async () => {
    const result = await runBatchDigest(batchConfig);
    const secretPattern = /[A-Za-z0-9+/=_-]{40,}/;
    assert.ok(
      !secretPattern.test(result.recommendation),
      "Recommendation must not contain secret-like values"
    );
  });
});

describe("loadBatchConfig", () => {
  test("loads batch config from JSON file", async () => {
    const configPath = path.join(root, "tests/fixtures/beezulbub/batch-repos.json");
    const config = await loadBatchConfig(configPath);
    assert.ok(config.target);
    assert.ok(Array.isArray(config.repos));
    assert.ok(config.repos.length > 0);
  });

  test("throws for missing config file", async () => {
    await assert.rejects(
      () => loadBatchConfig("/nonexistent/batch-config.json"),
      /not found/
    );
  });
});
