/**
 * tests/beezulbub-scout.test.ts
 *
 * Tests for Beezulbub scout — candidate ranking and fixture mode.
 * No live GitHub API calls.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { scoutCandidates } from "../src/beezulbub/scout.js";

const root = process.cwd();
const fixturesDir = path.join(root, "tests", "fixtures", "beezulbub");

describe("beezulbub:scout — fixture mode", () => {
  test("returns candidates for known target", async () => {
    const result = await scoutCandidates({ target: "dashboard_layout" });
    assert.ok(result.candidates.length > 0, "Should have candidates for dashboard_layout");
    assert.equal(result.target, "dashboard_layout");
    assert.equal(result.mode, "fixture");
  });

  test("ranks candidates by estimated value descending", async () => {
    const result = await scoutCandidates({ target: "dashboard_layout" });
    const values = result.candidates.map((c) => c.estimatedValue);
    for (let i = 0; i < values.length - 1; i++) {
      assert.ok(values[i]! >= values[i + 1]!, "Candidates must be sorted by value descending");
    }
  });

  test("returns empty candidates for unknown target", async () => {
    const result = await scoutCandidates({ target: "nonexistent_capability_xyz" });
    assert.equal(result.candidates.length, 0);
    assert.ok(result.recommendation.includes("No built-in candidates"));
  });

  test("loads candidates from JSON fixture file", async () => {
    const candidatesPath = path.join(fixturesDir, "candidates.json");
    const result = await scoutCandidates({
      target: "dashboard_layout",
      candidatesPath,
    });
    assert.ok(result.candidates.length > 0, "Should load from candidates.json");
    assert.ok(result.candidates.every((c) => c.targetCapability === "dashboard_layout"));
  });

  test("includes recommendation", async () => {
    const result = await scoutCandidates({ target: "dashboard_layout" });
    assert.ok(typeof result.recommendation === "string");
    assert.ok(result.recommendation.length > 0);
  });

  test("includes timestamp", async () => {
    const result = await scoutCandidates({ target: "pdf_parser" });
    assert.ok(!isNaN(Date.parse(result.timestamp)));
  });

  test("each candidate has required fields", async () => {
    const result = await scoutCandidates({ target: "dashboard_layout" });
    for (const c of result.candidates) {
      assert.ok(c.name, "Candidate must have name");
      assert.ok(c.targetCapability, "Candidate must have targetCapability");
      assert.ok(typeof c.estimatedValue === "number");
      assert.ok(["low", "medium", "high"].includes(c.staleRisk));
    }
  });
});
