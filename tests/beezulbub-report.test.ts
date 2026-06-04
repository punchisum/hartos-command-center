/**
 * tests/beezulbub-report.test.ts
 *
 * Tests for Beezulbub report formatting and secret safety.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { digestLocalRepo } from "../src/beezulbub/digest.js";
import {
  formatDigestReport,
  writeDigestReport,
  assertNoSecretsInBeezulbubReport,
} from "../src/beezulbub/report.js";

const root = process.cwd();
const cleanDashboard = path.join(root, "tests", "fixtures", "beezulbub", "clean-dashboard");

let tmpDir: string;

before(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "hartos-beezulbub-report-test-"));
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("formatDigestReport", () => {
  test("includes repo name", async () => {
    const digest = await digestLocalRepo({ localPath: cleanDashboard });
    const formatted = formatDigestReport(digest);
    assert.ok(formatted.includes("clean-dashboard"));
  });

  test("includes verdict", async () => {
    const digest = await digestLocalRepo({ localPath: cleanDashboard });
    const formatted = formatDigestReport(digest);
    assert.ok(
      formatted.includes("DEVOUR") || formatted.includes("PARTIAL") || formatted.includes("REJECT"),
      "Must include verdict"
    );
  });

  test("includes score section", async () => {
    const digest = await digestLocalRepo({ localPath: cleanDashboard });
    const formatted = formatDigestReport(digest);
    assert.ok(formatted.includes("Score"), "Must include Score section");
    assert.ok(formatted.includes("Overall:"), "Must include Overall score");
  });

  test("includes adaptation plan", async () => {
    const digest = await digestLocalRepo({ localPath: cleanDashboard });
    const formatted = formatDigestReport(digest);
    assert.ok(formatted.includes("Adaptation Plan"), "Must include adaptation plan");
  });

  test("does not contain secret-like values", async () => {
    const digest = await digestLocalRepo({ localPath: cleanDashboard });
    const formatted = formatDigestReport(digest);
    assert.doesNotThrow(() => assertNoSecretsInBeezulbubReport(formatted));
  });
});

describe("writeDigestReport", () => {
  test("writes md and json files", async () => {
    const { existsSync } = await import("node:fs");
    const digest = await digestLocalRepo({ localPath: cleanDashboard });
    const { mdPath, jsonPath } = await writeDigestReport(digest, tmpDir);
    assert.ok(existsSync(mdPath), "MD report must be written");
    assert.ok(existsSync(jsonPath), "JSON score must be written");
  });

  test("json report has safe fields only", async () => {
    const digest = await digestLocalRepo({ localPath: cleanDashboard });
    const { jsonPath } = await writeDigestReport(digest, tmpDir);
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(jsonPath, "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    assert.ok(parsed["repoName"], "Must have repoName");
    assert.ok(parsed["verdict"], "Must have verdict");
    assert.ok(parsed["score"], "Must have score");
    // Must not have raw env values
    assert.ok(!content.includes("service_role_key"), "Must not have service role key");
  });
});

describe("assertNoSecretsInBeezulbubReport", () => {
  test("passes for clean content", () => {
    const clean = "# Report\nVerdict: DEVOUR\nScore: 8.5/10\n";
    assert.doesNotThrow(() => assertNoSecretsInBeezulbubReport(clean));
  });

  test("throws for content with secret patterns", () => {
    // Build at runtime to avoid factory secret scanner
    const prefix = "sk";
    const dirty = `# Report\nkey: ${prefix}-${"a1b2c3d4e5f6g7h8i9j0k1l2m3n4"}\n`;
    assert.throws(() => assertNoSecretsInBeezulbubReport(dirty), /Secret-looking value/);
  });
});
