/**
 * tests/agent-report.test.ts — Phase 11I. Agent reports are generated safely.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildAgentIntegrationSummary } from "../src/agents/agent-read-model.js";
import { writeAgentReport, renderAgentReportMarkdown } from "../src/agents/agent-report.js";

describe("agent report", () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "agent-report-")); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("renders markdown for an unconfigured summary", async () => {
    const summary = await buildAgentIntegrationSummary({ cwd: dir });
    const md = renderAgentReportMarkdown(summary);
    assert.ok(md.includes("Agent Integration Status"));
    assert.ok(md.includes("No ClickUp / Apple Health / Google Drive / Telegram / Supabase mutations"));
  });

  it("writes md + json reports under the reports dir", async () => {
    const summary = await buildAgentIntegrationSummary({ cwd: dir });
    const { mdPath, jsonPath } = await writeAgentReport(path.join(dir, "agent-integration-reports"), summary);
    assert.ok(mdPath.endsWith(".md"));
    assert.ok(jsonPath.endsWith(".json"));
    const files = await readdir(path.join(dir, "agent-integration-reports"));
    assert.ok(files.some((f) => f.startsWith("agent-integration-status-")));
    const json = await readFile(jsonPath, "utf8");
    assert.ok(json.includes("configuredAgents"));
  });
});
