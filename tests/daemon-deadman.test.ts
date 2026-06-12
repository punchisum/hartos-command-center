/**
 * tests/daemon-deadman.test.ts — the dead-man's-switch pure read side + the daemon heartbeat write.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDaemonRpcResult, daemonAlert } from "../src/telegram/daemon-deadman.js";
import { writeDaemonHeartbeat, DAEMON_ID } from "../src/jobs/daemon-heartbeat-store.js";

describe("parseDaemonRpcResult", () => {
  it("parses a PostgREST array-of-one-row", () => {
    const r = parseDaemonRpcResult([{ should_alert: true, kind: "down", status: "alive", seconds_silent: 480, reason: "silent" }]);
    assert.equal(r?.should_alert, true);
    assert.equal(r?.kind, "down");
    assert.equal(r?.seconds_silent, 480);
  });
  it("parses a bare object and coerces unknown kinds to 'none'", () => {
    const r = parseDaemonRpcResult({ should_alert: false, kind: "weird", status: "alive", seconds_silent: 1, reason: "ok" });
    assert.equal(r?.kind, "none");
  });
  it("returns null on malformed input", () => {
    assert.equal(parseDaemonRpcResult(null), null);
    assert.equal(parseDaemonRpcResult([]), null);
    assert.equal(parseDaemonRpcResult([{ status: "alive" }]), null); // no should_alert
  });
});

describe("daemonAlert", () => {
  it("returns null when nothing should be sent", () => {
    assert.equal(daemonAlert({ should_alert: false, kind: "none", status: "alive", seconds_silent: 0, reason: "alive" }), null);
  });
  it("shapes a CRITICAL down alert with a stable key", () => {
    const a = daemonAlert({ should_alert: true, kind: "down", status: "silent", seconds_silent: 480, reason: "live-runner silent — last heartbeat 480s ago" })!;
    assert.equal(a.severity, "critical");
    assert.equal(a.key, "daemon:live-runner:down");
    assert.match(a.title, /DOWN/);
    assert.match(a.body, /8m silent/);
  });
  it("shapes an INFO recovery alert", () => {
    const a = daemonAlert({ should_alert: true, kind: "recovery", status: "alive", seconds_silent: 5, reason: "back online" })!;
    assert.equal(a.severity, "info");
    assert.equal(a.key, "daemon:live-runner:recovery");
  });
});

describe("writeDaemonHeartbeat", () => {
  it("upserts the live-runner row with the given status/reason", async () => {
    let captured: { sql: string; params: unknown[] } | null = null;
    const fakeDb = { async query(sql: string, params: unknown[]) { captured = { sql, params }; return { rows: [] }; }, async close() {} };
    const ok = await writeDaemonHeartbeat(() => fakeDb, "error", "boom");
    assert.equal(ok, true);
    assert.equal(captured!.params[0], DAEMON_ID);
    assert.equal(captured!.params[1], "error");
    assert.equal(captured!.params[2], "boom");
    assert.match(captured!.sql, /insert into public\.daemon_heartbeats/);
  });
  it("passes null reason for an alive beat and returns false when the spine is unconfigured", async () => {
    let params: unknown[] = [];
    const fakeDb = { async query(_s: string, p: unknown[]) { params = p; return { rows: [] }; }, async close() {} };
    await writeDaemonHeartbeat(() => fakeDb, "alive");
    assert.equal(params[2], null);
    assert.equal(await writeDaemonHeartbeat(() => null, "alive"), false);
  });
});
