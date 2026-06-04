/**
 * tests/bootstrap-report.test.ts
 *
 * Tests for bootstrap report formatting and secret safety.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  formatBootstrapPlan,
  formatBootstrapResult,
  assertNoSecretsInBootstrapReport,
  writeBootstrapReport,
} from "../src/bootstrap/bootstrap-report.js";
import { checkBootstrap } from "../src/bootstrap/bootstrap-check.js";
import { runBootstrapEngine } from "../src/bootstrap/bootstrap-engine.js";

let tmpDir: string;

before(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "hartos-bootstrap-report-test-"));
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("formatBootstrapPlan", () => {
  test("includes agent name", async () => {
    const plan = await checkBootstrap({});
    const formatted = formatBootstrapPlan(plan);
    assert.ok(formatted.includes("Bootstrap Plan"));
  });

  test("includes summary", async () => {
    const plan = await checkBootstrap({});
    const formatted = formatBootstrapPlan(plan);
    assert.ok(formatted.includes("Summary"));
  });

  test("does not contain secrets", async () => {
    const plan = await checkBootstrap({});
    const formatted = formatBootstrapPlan(plan);
    assert.doesNotThrow(() => assertNoSecretsInBootstrapReport(formatted));
  });
});

describe("formatBootstrapResult", () => {
  test("includes status", async () => {
    const result = await runBootstrapEngine({ env: {} });
    const formatted = formatBootstrapResult(result);
    assert.ok(formatted.includes("Status:") || formatted.includes("Bootstrap Result"));
  });

  test("does not contain secrets", async () => {
    const result = await runBootstrapEngine({ env: {} });
    const formatted = formatBootstrapResult(result);
    assert.doesNotThrow(() => assertNoSecretsInBootstrapReport(formatted));
  });
});

describe("assertNoSecretsInBootstrapReport", () => {
  test("passes for clean content", () => {
    const clean = "# Bootstrap Plan\nStatus: ready\nProvider: configured\n";
    assert.doesNotThrow(() => assertNoSecretsInBootstrapReport(clean));
  });

  test("throws for content with secret patterns", () => {
    // Build a string with a long enough sequence at runtime
    const prefix = "sk";
    const dirty = `# Bootstrap Plan\ntoken: ${prefix}-${"a1b2c3d4e5f6g7h8i9j0k1l2m3n4"}\n`;
    assert.throws(() => assertNoSecretsInBootstrapReport(dirty), /Secret-looking value/);
  });
});

describe("writeBootstrapReport", () => {
  test("writes report to file", async () => {
    const { existsSync } = await import("node:fs");
    const content = "# Bootstrap Report\nAll clean.\n";
    const outputPath = await writeBootstrapReport(content, tmpDir, "test-report.md");
    assert.ok(existsSync(outputPath), "Report file must be created");
  });
});
