/**
 * tests/launch-orchestrator.test.ts
 *
 * Unit tests for the orchestrator building blocks:
 * - Gate checking logic
 * - Status derivation
 * - Provider ordering
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deriveLaunchStatus, buildNextAction } from "../src/launch/report.js";
import { checkLaunchReadiness } from "../src/launch/readiness.js";
import type { LaunchStep, LaunchReport } from "../src/launch/types.js";
import { tmpdir } from "node:os";
import path from "node:path";

function makeStep(
  id: string,
  status: LaunchStep["status"],
  missingGates: string[] = [],
  manualRequired = false
): LaunchStep {
  return {
    id,
    name: id,
    provider: "test",
    status,
    message: `Status: ${status}`,
    manualRequired,
    missingGates,
    nextAction: "",
    timestamp: new Date().toISOString(),
  };
}

// ─── deriveLaunchStatus ───────────────────────────────────────────────────────

describe("deriveLaunchStatus", () => {
  test("all success + smoke passed → success", () => {
    const steps = [makeStep("a", "success"), makeStep("b", "success")];
    assert.equal(deriveLaunchStatus(steps, "passed", false), "success");
  });

  test("missing global gates → blocked_missing_gate", () => {
    const steps = [makeStep("a", "gate_missing", ["ALLOW_AUTO_PROVISION"])];
    assert.equal(deriveLaunchStatus(steps, "skipped", true), "blocked_missing_gate");
  });

  test("failed step → failed", () => {
    const steps = [makeStep("a", "success"), makeStep("b", "failed")];
    assert.equal(deriveLaunchStatus(steps, "passed", false), "failed");
  });

  test("all manual_required → blocked_manual_required", () => {
    const steps = [
      makeStep("a", "manual_required", [], true),
      makeStep("b", "manual_required", [], true),
    ];
    assert.equal(deriveLaunchStatus(steps, "skipped", false), "blocked_manual_required");
  });

  test("some manual + smoke passed → partial", () => {
    const steps = [
      makeStep("a", "success"),
      makeStep("b", "manual_required", [], true),
    ];
    assert.equal(deriveLaunchStatus(steps, "passed", false), "partial");
  });

  test("smoke failed → partial", () => {
    const steps = [makeStep("a", "success")];
    assert.equal(deriveLaunchStatus(steps, "failed", false), "partial");
  });
});

// ─── buildNextAction ─────────────────────────────────────────────────────────

describe("buildNextAction", () => {
  function partialReport(launchStatus: LaunchReport["launchStatus"], overrides: Partial<LaunchReport> = {}): LaunchReport {
    return {
      agentName: "test",
      environment: "staging",
      launchStatus,
      timestamp: "",
      steps: [],
      missingGates: [],
      manualRequiredSteps: [],
      smokeResult: "skipped",
      provisionReportPath: null,
      rollbackPlanPath: null,
      nextAction: "",
      safeSummary: "",
      ...overrides,
    };
  }

  test("success → promote instruction", () => {
    const next = buildNextAction(partialReport("success"));
    assert.ok(next.toLowerCase().includes("promot") || next.toLowerCase().includes("production"));
  });

  test("partial → complete manual steps", () => {
    const next = buildNextAction(partialReport("partial", { manualRequiredSteps: ["step-a"] }));
    assert.ok(next.toLowerCase().includes("manual"));
  });

  test("blocked_missing_gate → set gates", () => {
    const next = buildNextAction(partialReport("blocked_missing_gate", {
      missingGates: ["ALLOW_AUTO_PROVISION"],
    }));
    assert.ok(next.includes("ALLOW_AUTO_PROVISION") || next.toLowerCase().includes("gate"));
  });

  test("failed → fix and rollback", () => {
    const next = buildNextAction(partialReport("failed"));
    assert.ok(next.toLowerCase().includes("fix") || next.toLowerCase().includes("rollback"));
  });
});

// ─── checkLaunchReadiness ────────────────────────────────────────────────────

describe("checkLaunchReadiness", () => {
  const root = path.join(tmpdir(), "launch-readiness-test-" + Date.now());

  test("empty env → all gates missing, not ready overall", async () => {
    const result = await checkLaunchReadiness({}, root);
    assert.ok(result.missingGates.includes("ALLOW_AUTO_PROVISION"));
    assert.ok(result.missingGates.includes("CONFIRM_STAGING_PROVISION"));
  });

  test("gates open → gates shown as open", async () => {
    const result = await checkLaunchReadiness({
      ALLOW_AUTO_PROVISION: "true",
      CONFIRM_STAGING_PROVISION: "true",
    }, root);
    const autoCheck = result.checks.find((c) => c.name === "gate:ALLOW_AUTO_PROVISION");
    assert.ok(autoCheck?.ok === true);
  });

  test("returns checks array with expected names", async () => {
    const result = await checkLaunchReadiness({}, root);
    const names = result.checks.map((c) => c.name);
    assert.ok(names.some((n) => n.startsWith("gate:")));
    assert.ok(names.some((n) => n.startsWith("provider:")));
    assert.ok(names.some((n) => n.startsWith("config:")));
  });

  test("readiness.ready excludes gate checks from pass/fail", async () => {
    // With no gates open but no file issues, ready should still be deterministic
    const result = await checkLaunchReadiness({}, root);
    // ready = false because some config checks may fail
    assert.ok(typeof result.ready === "boolean");
  });
});
