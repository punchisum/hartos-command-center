/**
 * tests/run-clickup-move.test.ts — §14 (T3 external clickup-move-status).
 *
 * All hermetic (injected timestamp, fake ClickUpRestClient, no env/network/fs):
 *  1. The client-backed store pins the HTTP surface — getCard maps task→{id,name,status},
 *     moveCard issues setStatus.
 *  2. `runClickUpMove` is fail-closed: flag OFF (default) refuses (no setStatus), the kill-switch
 *     overrides a 'true' flag, the happy path moves once on an APPROVED transition with before/after,
 *     an UNAPPROVED transition refuses, a target that changed underneath us (live != from) refuses,
 *     an already-in-target re-run is an idempotent no-op, and dryRun never writes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeClickUpMoveStore, type ClickUpRestClient } from "../src/execution/clickup-client.js";
import { runClickUpMove } from "../src/execution/run-clickup-move.js";
import { CLICKUP_MOVE_FLAG, isApprovedTransition } from "../src/execution/adapters/clickup-move-status.js";
import { KILL_SWITCH_ENV } from "../src/execution/execution-adapter.js";

const NOW = "2026-06-09T12:00:00.000Z";
const PROPOSAL = { id: "p-auth", status: "approved_for_execution" as const, expiresAt: null };
const CARD = { id: "card-123", name: "Virtual Card API Clarification" };

function fakeClient(currentStatus: string | null): {
  client: ClickUpRestClient;
  calls: Array<{ op: string; args: unknown[] }>;
} {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  let status = currentStatus;
  const client: ClickUpRestClient = {
    async getTask(taskId) {
      calls.push({ op: "getTask", args: [taskId] });
      return status === null ? null : { id: CARD.id, name: CARD.name, status };
    },
    async listComments(taskId) { calls.push({ op: "listComments", args: [taskId] }); return []; },
    async createComment(taskId, text) { calls.push({ op: "createComment", args: [taskId, text] }); return { id: "c-1" }; },
    async setStatus(taskId, s) { calls.push({ op: "setStatus", args: [taskId, s] }); status = s; },
  };
  return { client, calls };
}

function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  return fn().then((result) => ({ result, logs })).finally(() => { console.log = orig; });
}

const target = (fromStatus: string, toStatus: string) => ({ cardId: CARD.id, cardName: CARD.name, fromStatus, toStatus });

describe("clickup-move approved-transition allowlist (pure)", () => {
  it("accepts pre-approved transitions (case/space-insensitive), rejects the rest", () => {
    assert.equal(isApprovedTransition("Waiting on Hart", "In Progress"), true);
    assert.equal(isApprovedTransition("in progress", "in review"), true);
    assert.equal(isApprovedTransition("Waiting on Hart", "Complete"), false, "skipping stages is not approved");
    assert.equal(isApprovedTransition("in progress", "waiting on hart"), false, "moving backwards is not approved");
  });
});

describe("clickup-move client store", () => {
  it("getCard maps a task to {id,name,status}; moveCard issues setStatus", async () => {
    const { client, calls } = fakeClient("waiting on hart");
    const store = makeClickUpMoveStore(client);
    assert.deepEqual(await store.getCard("card-123"), { id: "card-123", name: CARD.name, status: "waiting on hart" });
    await store.moveCard("card-123", "in progress");
    assert.deepEqual(calls.find((c) => c.op === "setStatus")!.args, ["card-123", "in progress"]);
  });
});

describe("runClickUpMove — fail-closed gate (§14, T3 external)", () => {
  it("flag OFF (default, env {}) → refused, NOT executed; no setStatus", async () => {
    const { client, calls } = fakeClient("waiting on hart");
    const { result, logs } = await captureLogs(() =>
      runClickUpMove(PROPOSAL, target("waiting on hart", "in progress"), {}, {
        now: NOW, store: makeClickUpMoveStore(client), hasCapabilityToken: true,
      }),
    );
    assert.equal(result.executed, false);
    assert.equal(calls.some((c) => c.op === "setStatus"), false);
    assert.ok(logs.some((l) => l.includes("execution_attempt")));
    assert.ok(logs.some((l) => l.includes("execution_refused")));
  });

  it("global kill-switch overrides a 'true' flag → refused, no setStatus", async () => {
    const { client, calls } = fakeClient("waiting on hart");
    const { result } = await captureLogs(() =>
      runClickUpMove(PROPOSAL, target("waiting on hart", "in progress"), { [CLICKUP_MOVE_FLAG]: "true", [KILL_SWITCH_ENV]: "on" }, {
        now: NOW, store: makeClickUpMoveStore(client), hasCapabilityToken: true,
      }),
    );
    assert.equal(result.executed, false);
    assert.equal(calls.some((c) => c.op === "setStatus"), false);
  });

  it("happy path: flag ON + approved transition + live status confirmed → moves once, before/after, reversible", async () => {
    const { client, calls } = fakeClient("waiting on hart");
    const { result, logs } = await captureLogs(() =>
      runClickUpMove(PROPOSAL, target("waiting on hart", "in progress"), { [CLICKUP_MOVE_FLAG]: "true" }, {
        now: NOW, store: makeClickUpMoveStore(client), hasCapabilityToken: true,
      }),
    );
    assert.equal(result.executed, true);
    assert.equal(result.outcome?.reversible, true);
    assert.deepEqual(result.outcome?.before, { status: "waiting on hart" });
    assert.deepEqual(result.outcome?.after, { status: "in progress" });
    assert.equal(calls.filter((c) => c.op === "setStatus").length, 1);
    assert.ok(logs.some((l) => l.includes("executed")));
  });

  it("unapproved transition → refused, no setStatus", async () => {
    const { client, calls } = fakeClient("waiting on hart");
    const { result } = await captureLogs(() =>
      runClickUpMove(PROPOSAL, target("waiting on hart", "complete"), { [CLICKUP_MOVE_FLAG]: "true" }, {
        now: NOW, store: makeClickUpMoveStore(client), hasCapabilityToken: true,
      }),
    );
    assert.equal(result.executed, false);
    assert.match(String(result.outcome?.summary), /not approved/i);
    assert.equal(calls.some((c) => c.op === "setStatus"), false);
  });

  it("read-before-write: live status != asserted from → refuse (target changed underneath us)", async () => {
    // We assert from "waiting on hart" but the card is actually already "in progress".
    const { client, calls } = fakeClient("in progress");
    const { result } = await captureLogs(() =>
      runClickUpMove(PROPOSAL, target("waiting on hart", "in review"), { [CLICKUP_MOVE_FLAG]: "true" }, {
        now: NOW, store: makeClickUpMoveStore(client), hasCapabilityToken: true,
      }),
    );
    assert.equal(result.executed, false);
    assert.match(String(result.outcome?.summary), /!=|changed underneath/i);
    assert.equal(calls.some((c) => c.op === "setStatus"), false);
  });

  it("idempotent: a card already in the target status is a no-op (re-run moves 0)", async () => {
    const { client, calls } = fakeClient("in progress");
    const { result } = await captureLogs(() =>
      runClickUpMove(PROPOSAL, target("waiting on hart", "in progress"), { [CLICKUP_MOVE_FLAG]: "true" }, {
        now: NOW, store: makeClickUpMoveStore(client), hasCapabilityToken: true,
      }),
    );
    assert.equal(result.executed, false);
    assert.match(String(result.outcome?.summary), /already in/i);
    assert.equal(calls.some((c) => c.op === "setStatus"), false);
  });

  it("read-before-write: a missing card refuses, writes nothing", async () => {
    const { client, calls } = fakeClient(null);
    const { result } = await captureLogs(() =>
      runClickUpMove(PROPOSAL, target("waiting on hart", "in progress"), { [CLICKUP_MOVE_FLAG]: "true" }, {
        now: NOW, store: makeClickUpMoveStore(client), hasCapabilityToken: true,
      }),
    );
    assert.equal(result.executed, false);
    assert.match(String(result.outcome?.summary), /not found/i);
    assert.equal(calls.some((c) => c.op === "setStatus"), false);
  });

  it("dryRun never writes (preview only)", async () => {
    const { client, calls } = fakeClient("waiting on hart");
    const { result } = await captureLogs(() =>
      runClickUpMove(PROPOSAL, target("waiting on hart", "in progress"), { [CLICKUP_MOVE_FLAG]: "true" }, {
        now: NOW, dryRun: true, store: makeClickUpMoveStore(client), hasCapabilityToken: true,
      }),
    );
    assert.equal(result.executed, false);
    assert.deepEqual(result.outcome?.before, { status: "waiting on hart" });
    assert.deepEqual(result.outcome?.after, { status: "in progress" });
    assert.equal(calls.some((c) => c.op === "setStatus"), false);
  });
});
