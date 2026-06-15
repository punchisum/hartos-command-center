import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrganRegistryView } from "../src/cockpit/organs/organ-registry-view.js";

const NOW = "2026-06-14T12:00:00.000Z";

/** A registry contract row as hartos_list_agent_registry() returns it. */
function regRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agent_id: "sentinel",
    display_name: "Sentinel",
    capability_summary: "Fleet liveness.",
    parent_id: null,
    tier: "T1",
    lifecycle: "approved",
    permissions: { propose: true, execute: false },
    arming_flag: "HARTOS_ALLOW_SENTINEL_WOLVERINE",
    known_risks: [],
    runtime_kind: "daemon-supervised",
    heartbeat_source: "organ_runs(sentinel) + worker cron",
    can_write_external: false,
    detail_page: "/agent/sentinel",
    last_run_at: null,
    last_output_ref: null,
    staleness_threshold_sec: 900,
    ...over,
  };
}

/** An organ_runs row as hartos_list_organ_runs() returns it. */
function runRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    organ_id: "sentinel",
    run_at: "2026-06-14T11:59:30.000Z",
    trigger: "scheduled",
    ok: true,
    disarmed: false,
    output_ref: "organ_runs:42",
    summary: "Assessed 11 organs — fleet GREEN.",
    duration_ms: 120,
    ...over,
  };
}

test("registered, no runs => REGISTERED", () => {
  const view = buildOrganRegistryView([regRow()], [], NOW);
  assert.equal(view.length, 1);
  assert.equal(view[0]!.status, "REGISTERED");
  assert.equal(view[0]!.lastRunAt, null);
  assert.equal(view[0]!.lastOutputRef, null);
  assert.equal(view[0]!.lastRunSummary, null);
});

test("fresh run + output + readback => LIVE", () => {
  // last_run_at 30s ago (< 900s threshold) + a real scheduled run + output_ref ⇒ all four parts.
  const reg = regRow({ last_run_at: "2026-06-14T11:59:30.000Z", last_output_ref: "organ_runs:42" });
  const view = buildOrganRegistryView([reg], [runRow()], NOW);
  assert.equal(view[0]!.status, "LIVE");
  assert.equal(view[0]!.lastOutputRef, "organ_runs:42");
  assert.equal(view[0]!.lastRunSummary, "Assessed 11 organs — fleet GREEN.");
  assert.equal(view[0]!.heartbeatSource, "organ_runs(sentinel) + worker cron");
});

test("disarmed run => PARTIAL (not LIVE)", () => {
  const reg = regRow({ last_run_at: "2026-06-14T11:59:30.000Z", last_output_ref: "organ_runs:43" });
  const view = buildOrganRegistryView([reg], [runRow({ disarmed: true, output_ref: "organ_runs:43" })], NOW);
  assert.equal(view[0]!.status, "PARTIAL");
});

test("retired lifecycle => RETIRED regardless of runs", () => {
  const reg = regRow({ lifecycle: "retired", last_run_at: "2026-06-14T11:59:30.000Z", last_output_ref: "organ_runs:1" });
  const view = buildOrganRegistryView([reg], [runRow()], NOW);
  assert.equal(view[0]!.status, "RETIRED");
});

test("errored run => FAILED", () => {
  const reg = regRow({ last_run_at: "2026-06-14T11:59:30.000Z", last_output_ref: "organ_runs:9" });
  const view = buildOrganRegistryView([reg], [runRow({ ok: false, errored: true })], NOW);
  assert.equal(view[0]!.status, "FAILED");
});

test("honest ok:false (not errored) => PARTIAL, never FAILED", () => {
  // An organ that ran and honestly reported not-yet-live (disarmed / no input / empty) is PARTIAL,
  // not FAILED. This is the dishonest-FAILED bug the SOT verification caught.
  const reg = regRow({ last_run_at: "2026-06-14T11:59:30.000Z", last_output_ref: null });
  const view = buildOrganRegistryView([reg], [runRow({ ok: false, errored: false, output_ref: null })], NOW);
  assert.equal(view[0]!.status, "PARTIAL");
});

test("stale heartbeat (older than threshold) => FAILED", () => {
  // last_run_at ~2h ago, threshold 900s ⇒ stale ⇒ FAILED even with an output_ref.
  const reg = regRow({ last_run_at: "2026-06-14T10:00:00.000Z", last_output_ref: "organ_runs:7" });
  const view = buildOrganRegistryView([reg], [runRow({ run_at: "2026-06-14T10:00:00.000Z" })], NOW);
  assert.equal(view[0]!.status, "FAILED");
});

test("permissions.execute + can_write_external project through", () => {
  const reg = regRow({ agent_id: "factory", permissions: { propose: true, execute: true }, can_write_external: true });
  const view = buildOrganRegistryView([reg], [], NOW);
  assert.equal(view[0]!.canExecute, true);
  assert.equal(view[0]!.canWriteExternal, true);
});

test("permissions can arrive as a JSON string", () => {
  const reg = regRow({ permissions: '{"propose":true,"execute":true}' });
  const view = buildOrganRegistryView([reg], [], NOW);
  assert.equal(view[0]!.canExecute, true);
});

test("latest run per organ wins (newest-first input)", () => {
  const reg = regRow({ last_run_at: "2026-06-14T11:59:30.000Z", last_output_ref: "organ_runs:99" });
  const runs = [
    runRow({ output_ref: "organ_runs:99", summary: "newest", run_at: "2026-06-14T11:59:30.000Z" }),
    runRow({ output_ref: "organ_runs:50", summary: "older", run_at: "2026-06-14T10:00:00.000Z" }),
  ];
  const view = buildOrganRegistryView([reg], runs, NOW);
  assert.equal(view[0]!.lastRunSummary, "newest");
  assert.equal(view[0]!.status, "LIVE");
});

test("malformed / empty input degrades safely (never throws)", () => {
  assert.deepEqual(buildOrganRegistryView(undefined, undefined, NOW), []);
  assert.deepEqual(buildOrganRegistryView(null, null, NOW), []);
  assert.deepEqual(buildOrganRegistryView("garbage", 42, NOW), []);
  // a row with no agent_id is skipped; a good row alongside it still renders.
  const view = buildOrganRegistryView([{ display_name: "no id" }, regRow()], [], NOW);
  assert.equal(view.length, 1);
  assert.equal(view[0]!.agentId, "sentinel");
});
