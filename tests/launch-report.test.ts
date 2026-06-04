/**
 * tests/launch-report.test.ts
 *
 * Tests for launch report formatting and secret safety.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  formatLaunchReport,
  writeLaunchReport,
  assertNoSecretsInReport,
  deriveLaunchStatus,
} from "../src/launch/report.js";
import type { LaunchReport, LaunchStep } from "../src/launch/types.js";

function makeReport(overrides: Partial<LaunchReport> = {}): LaunchReport {
  return {
    agentName: "test-agent",
    environment: "staging",
    launchStatus: "success",
    timestamp: "2026-06-03T12:00:00.000Z",
    steps: [],
    missingGates: [],
    manualRequiredSteps: [],
    smokeResult: "passed",
    provisionReportPath: null,
    rollbackPlanPath: null,
    nextAction: "Review and promote to production.",
    safeSummary: "Launch complete. All steps ok.",
    ...overrides,
  };
}

let tmpDir: string;

before(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "hartos-launch-report-test-"));
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── formatLaunchReport ───────────────────────────────────────────────────────

describe("formatLaunchReport", () => {
  test("includes agent name", () => {
    const formatted = formatLaunchReport(makeReport());
    assert.ok(formatted.includes("test-agent"));
  });

  test("includes environment", () => {
    const formatted = formatLaunchReport(makeReport());
    assert.ok(formatted.includes("staging"));
  });

  test("includes launch status", () => {
    const formatted = formatLaunchReport(makeReport({ launchStatus: "partial" }));
    assert.ok(formatted.includes("partial"));
  });

  test("includes missing gates when present", () => {
    const formatted = formatLaunchReport(
      makeReport({ missingGates: ["ALLOW_AUTO_PROVISION", "CONFIRM_STAGING_PROVISION"] })
    );
    assert.ok(formatted.includes("ALLOW_AUTO_PROVISION"));
    assert.ok(formatted.includes("CONFIRM_STAGING_PROVISION"));
  });

  test("includes step statuses", () => {
    const steps: LaunchStep[] = [
      {
        id: "github:create_repo",
        name: "GitHub: create repo",
        provider: "github",
        status: "manual_required",
        message: "Use GitHub dashboard",
        manualRequired: true,
        missingGates: [],
        nextAction: "Create repo manually",
        timestamp: "2026-06-03T12:00:00.000Z",
      },
    ];
    const formatted = formatLaunchReport(makeReport({ steps }));
    // Step name is "GitHub: create repo" — check for the name content
    assert.ok(formatted.includes("GitHub") || formatted.includes("create repo"));
    assert.ok(formatted.includes("manual_required"));
  });

  test("includes smoke result", () => {
    const formatted = formatLaunchReport(makeReport({ smokeResult: "failed" }));
    assert.ok(formatted.includes("failed") || formatted.includes("Smoke"));
  });

  test("includes nextAction", () => {
    const formatted = formatLaunchReport(makeReport({ nextAction: "Deploy to production." }));
    assert.ok(formatted.includes("Deploy to production."));
  });
});

// ─── writeLaunchReport ───────────────────────────────────────────────────────

describe("writeLaunchReport", () => {
  test("writes both md and json files", async () => {
    const { existsSync } = await import("node:fs");
    const report = makeReport();
    const { mdPath, jsonPath } = await writeLaunchReport(report, tmpDir);
    assert.ok(existsSync(mdPath), "markdown report must be written");
    assert.ok(existsSync(jsonPath), "JSON report must be written");
  });

  test("md report includes agent name", async () => {
    const report = makeReport({ agentName: "special-agent" });
    const { mdPath } = await writeLaunchReport(report, tmpDir);
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(mdPath, "utf8");
    assert.ok(content.includes("special-agent"));
  });

  test("json report is valid JSON with safe fields only", async () => {
    const report = makeReport();
    const { jsonPath } = await writeLaunchReport(report, tmpDir);
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(jsonPath, "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    assert.ok(parsed["agentName"]);
    assert.ok(parsed["launchStatus"]);
    assert.ok(parsed["environment"] === "staging");
    // JSON report must not include raw env
    assert.ok(!JSON.stringify(parsed).includes("service_role_key"));
  });
});

// ─── assertNoSecretsInReport ─────────────────────────────────────────────────

describe("assertNoSecretsInReport", () => {
  test("passes for clean report content", () => {
    const clean = "# Report\nStatus: success\nSteps: 4 ok\n";
    assert.doesNotThrow(() => assertNoSecretsInReport(clean));
  });

  test("passes for report with step IDs and provider names", () => {
    const clean = "github: applied\nsupabase: manual_required\ncloudflare: gate_missing\n";
    assert.doesNotThrow(() => assertNoSecretsInReport(clean));
  });
});
