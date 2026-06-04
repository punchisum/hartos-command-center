/**
 * tests/release-report.test.ts
 *
 * Tests for deployment report building and formatting.
 * Verifies no secrets in output.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildDeploymentReport,
  formatDeploymentReport,
  assertNoSecrets,
  type DeploymentReport,
} from "../src/runtime/deployment-report.js";

// ─── buildDeploymentReport ────────────────────────────────────────────────────

describe("buildDeploymentReport", () => {
  test("fills required fields with defaults", () => {
    const report = buildDeploymentReport({ agentName: "test-agent", environment: "staging" });
    assert.equal(report.agentName, "test-agent");
    assert.equal(report.environment, "staging");
    assert.ok(report.timestamp);
    assert.deepEqual(report.migrationsApplied, []);
    assert.deepEqual(report.migrationsPending, []);
    assert.equal(report.cloudflareDeployed, false);
    assert.equal(report.cloudflareHealthy, null);
    assert.equal(report.smokeTestPassed, null);
  });

  test("allows override of defaults", () => {
    const report = buildDeploymentReport({
      agentName: "test-agent",
      environment: "production",
      cloudflareDeployed: true,
      cloudflareHealthy: true,
      smokeTestPassed: true,
      migrationsApplied: ["000001_core.sql"],
    });
    assert.equal(report.cloudflareDeployed, true);
    assert.equal(report.cloudflareHealthy, true);
    assert.equal(report.smokeTestPassed, true);
    assert.deepEqual(report.migrationsApplied, ["000001_core.sql"]);
  });
});

// ─── formatDeploymentReport ───────────────────────────────────────────────────

describe("formatDeploymentReport", () => {
  const baseReport: DeploymentReport = buildDeploymentReport({
    agentName: "my-agent",
    environment: "staging",
    migrationsApplied: ["000001_core.sql", "000002_events.sql"],
    migrationsPending: [],
    cloudflareDeployed: true,
    cloudflareHealthy: true,
    telegramWebhookRegistered: true,
    smokeTestPassed: true,
    notes: ["Deployed from main branch"],
  });

  test("contains agent name", () => {
    const formatted = formatDeploymentReport(baseReport);
    assert.ok(formatted.includes("my-agent"), "Report must include agent name");
  });

  test("contains environment", () => {
    const formatted = formatDeploymentReport(baseReport);
    assert.ok(formatted.includes("staging"), "Report must include environment");
  });

  test("contains applied migration filenames", () => {
    const formatted = formatDeploymentReport(baseReport);
    assert.ok(formatted.includes("000001_core.sql"), "Report must list applied migrations");
    assert.ok(formatted.includes("000002_events.sql"));
  });

  test("contains deployment status", () => {
    const formatted = formatDeploymentReport(baseReport);
    assert.ok(formatted.includes("Cloudflare"), "Report must include Cloudflare status");
    assert.ok(formatted.includes("Telegram"), "Report must include Telegram status");
  });

  test("contains smoke test result", () => {
    const formatted = formatDeploymentReport(baseReport);
    assert.ok(formatted.includes("Smoke"), "Report must include smoke test section");
  });

  test("contains timestamp", () => {
    const formatted = formatDeploymentReport(baseReport);
    assert.ok(formatted.includes(baseReport.timestamp), "Report must include timestamp");
  });

  test("contains notes", () => {
    const formatted = formatDeploymentReport(baseReport);
    assert.ok(formatted.includes("Deployed from main branch"), "Report must include notes");
  });

  test("does not contain known secret patterns", () => {
    const formatted = formatDeploymentReport(baseReport);
    assert.ok(!formatted.match(/sk-[A-Za-z0-9_-]{20,}/), "Report must not contain API key patterns");
    assert.ok(!formatted.match(/SERVICE_ROLE_KEY\s*=\s*\S+/), "Report must not contain secret values");
  });
});

// ─── assertNoSecrets ─────────────────────────────────────────────────────────

describe("assertNoSecrets", () => {
  test("passes for a clean report", () => {
    const clean = "# Report\nEnvironment: staging\nApplied: 2\n";
    assert.doesNotThrow(() => assertNoSecrets(clean));
  });

  test("throws for a report with an API key pattern", () => {
    // Split to avoid the secret scanner triggering on this test file itself.
    const prefix = "sk";
    const dirty = `# Report\nAPI key: ${prefix}-${"a1b2c3d4e5f6g7h8i9j0k1l2"}\n`;
    assert.throws(() => assertNoSecrets(dirty), /Secret-looking value/);
  });

  test("throws for a report with a JWT-like pattern", () => {
    // Construct JWT-like pattern at runtime to avoid secret scanner on this file.
    const header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const payload = "eyJzdWIiOiJ1c2VyIiwibmFtZSI6IlRlc3QifQ";
    const sig = "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const dirty = `# Report\nToken: ${header}.${payload}.${sig}\n`;
    assert.throws(() => assertNoSecrets(dirty), /Secret-looking value/);
  });
});

// ─── Production report has stricter notes ────────────────────────────────────

describe("production deployment report", () => {
  test("can be formatted without errors", () => {
    const report = buildDeploymentReport({
      agentName: "prod-agent",
      environment: "production",
      cloudflareDeployed: true,
      cloudflareHealthy: true,
      smokeTestPassed: true,
      warnings: ["Verify data integrity after migration"],
    });
    const formatted = formatDeploymentReport(report);
    assert.ok(formatted.includes("production"));
    assert.ok(formatted.includes("Verify data integrity"));
  });
});
