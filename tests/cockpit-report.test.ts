/**
 * tests/cockpit-report.test.ts
 *
 * Phase 11H — cockpit report tests. Local, deterministic, secret-safe.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCockpitState } from "../src/cockpit/cockpit-read-model.js";
import {
  formatSnapshotReport,
  writeSnapshotReport,
  assertNoSecretsInReport,
  DEFAULT_COCKPIT_REPORTS_DIR,
} from "../src/cockpit/cockpit-report.js";

describe("cockpit report", () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "cockpit-report-")); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("formats a snapshot report with required sections", async () => {
    const state = await buildCockpitState({ cwd: dir });
    const md = formatSnapshotReport(state);
    assert.ok(md.includes("Local Visible Cockpit"));
    assert.ok(md.includes("Card count: 22"));
    assert.ok(md.includes("Forbidden actions:"));
    assert.ok(md.includes("Approval-required actions:"));
    assert.ok(md.includes("Next recommended command:"));
    assert.ok(md.includes("no provider mutation") || md.includes("no Supabase mutation") || md.includes("no pack mutation"));
  });

  it("writes snapshot report files under cockpit-reports/", async () => {
    const state = await buildCockpitState({ cwd: dir });
    const reportsDir = path.join(dir, DEFAULT_COCKPIT_REPORTS_DIR);
    const { mdPath, jsonPath } = await writeSnapshotReport(reportsDir, state);
    assert.ok(mdPath.endsWith(".md"));
    assert.ok(jsonPath.endsWith(".json"));
    const files = await readdir(reportsDir);
    assert.ok(files.some((f) => f.startsWith("cockpit-snapshot-") && f.endsWith(".md")));
    assert.ok(files.some((f) => f.startsWith("cockpit-snapshot-") && f.endsWith(".json")));
  });

  it("reports contain no secret-looking values", async () => {
    const state = await buildCockpitState({ cwd: dir });
    const reportsDir = path.join(dir, DEFAULT_COCKPIT_REPORTS_DIR);
    await writeSnapshotReport(reportsDir, state);
    const files = await readdir(reportsDir);
    for (const f of files) {
      const content = await readFile(path.join(reportsDir, f), "utf8");
      assert.doesNotThrow(() => assertNoSecretsInReport(content));
    }
  });

  it("aborts a report containing a secret", () => {
    const fakeSecret = "sk-" + "a".repeat(32);
    assert.throws(() => assertNoSecretsInReport(`leak ${fakeSecret}`));
  });
});
