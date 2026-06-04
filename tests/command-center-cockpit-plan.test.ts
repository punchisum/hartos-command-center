/**
 * tests/command-center-cockpit-plan.test.ts
 *
 * Phase 11G — cockpit plan + report tests.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildReadModel } from "../src/command-center/read-model.js";
import { buildCockpitPlan, FUTURE_COCKPIT_PHASES } from "../src/command-center/cockpit-plan.js";
import { buildCommandCenterSnapshot } from "../src/command-center/command-center.js";
import {
  formatDataContractReport,
  formatCardRegistryReport,
  formatCockpitPlanReport,
  assertNoSecretsInReport,
  writeReport,
  DEFAULT_REPORTS_DIR,
} from "../src/command-center/command-center-report.js";

describe("command center cockpit plan", () => {
  it("classifies action states and recommends a safe next command", async () => {
    const models = await buildReadModel({ cwd: await mkdtemp(path.join(tmpdir(), "cc-plan-")) });
    const plan = buildCockpitPlan(models, new Date("2026-06-04T00:00:00Z"));
    assert.ok(plan.readOnlyActions.includes("view_report"));
    assert.ok(plan.forbiddenActions.includes("execute_provider_mutation"));
    assert.ok(plan.approvalRequiredActions.includes("promote_pack"));
    assert.ok(plan.manualRequiredActions.includes("deploy_agent"));
    // Next command is always local & safe, never a mutation.
    assert.ok(plan.nextRecommendedCommand.startsWith("npm run"));
    assert.ok(!plan.nextRecommendedCommand.includes("deploy"));
  });

  it("documents future cockpit phases (no UI built in 11G)", () => {
    assert.ok(FUTURE_COCKPIT_PHASES.length >= 2);
    for (const phase of FUTURE_COCKPIT_PHASES) {
      assert.equal(phase.status, "future");
    }
  });
});

describe("command center reports", () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "cc-report-")); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("generates all three reports locally", async () => {
    const snapshot = await buildCommandCenterSnapshot({ cwd: dir });
    const reportsDir = path.join(dir, DEFAULT_REPORTS_DIR);

    await writeReport(reportsDir, "data-contract", formatDataContractReport(snapshot.contract, snapshot.readModels));
    await writeReport(reportsDir, "card-registry", formatCardRegistryReport(snapshot.contract.cards, snapshot.readModels));
    await writeReport(reportsDir, "cockpit-plan", formatCockpitPlanReport(snapshot.plan));

    const files = await readdir(reportsDir);
    assert.ok(files.some((f) => f.startsWith("data-contract-") && f.endsWith(".md")));
    assert.ok(files.some((f) => f.startsWith("card-registry-") && f.endsWith(".md")));
    assert.ok(files.some((f) => f.startsWith("cockpit-plan-") && f.endsWith(".md")));
  });

  it("reports state the brain/surface rule and required summary fields", async () => {
    const snapshot = await buildCommandCenterSnapshot({ cwd: dir });
    const report = formatDataContractReport(snapshot.contract, snapshot.readModels);
    assert.ok(report.includes("Orchestrator is the brain"));
    assert.ok(report.includes("Command Center is a read/control surface"));
    assert.ok(report.includes("Card count:"));
    assert.ok(report.includes("Forbidden / blocked actions"));
    assert.ok(report.includes("Approval-required actions"));
    assert.ok(report.includes("Allowed local source roots"));
  });

  it("reports contain no secret-looking values", async () => {
    const snapshot = await buildCommandCenterSnapshot({ cwd: dir });
    const reportsDir = path.join(dir, DEFAULT_REPORTS_DIR);
    const files = await readdir(reportsDir);
    for (const f of files) {
      const content = await readFile(path.join(reportsDir, f), "utf8");
      assert.doesNotThrow(() => assertNoSecretsInReport(content));
    }
  });

  it("aborts a report that contains a secret", () => {
    // Build the secret-looking value at runtime so the literal never sits in source.
    const fakeSecret = "sk-" + "a".repeat(32);
    assert.throws(() => assertNoSecretsInReport(`token ${fakeSecret}`));
  });
});
