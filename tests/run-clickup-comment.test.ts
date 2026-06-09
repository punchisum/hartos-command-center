/**
 * tests/run-clickup-comment.test.ts — §14 (T3 external clickup-comment).
 *
 * All hermetic (injected timestamp, fake ClickUpRestClient, no env/network/fs):
 *  1. The client-backed store pins the HTTP surface via a fake client — getCard maps task→{id,name},
 *     addComment embeds the hartos-idem marker, findCommentByIdempotencyKey scans for that marker.
 *  2. `runClickUpComment` is fail-closed: flag OFF (default) refuses (attempt + refusal audited,
 *     no comment posted), the kill-switch overrides a 'true' flag, the happy path posts exactly one
 *     comment with before/after, an idempotent re-run posts 0, a missing card refuses, and dryRun
 *     never writes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  makeClickUpCommentStore,
  clickupIdempotencyMarker,
  type ClickUpRestClient,
} from "../src/execution/clickup-client.js";
import { runClickUpComment, clickupCommentIdempotencyKey } from "../src/execution/run-clickup-comment.js";
import { CLICKUP_COMMENT_FLAG } from "../src/execution/adapters/clickup-comment.js";
import { KILL_SWITCH_ENV } from "../src/execution/execution-adapter.js";

const NOW = "2026-06-09T12:00:00.000Z";
const PROPOSAL = { id: "p-auth", status: "approved_for_execution" as const, expiresAt: null };
const TARGET = { cardId: "card-123", cardName: "Virtual Card API Clarification", commentText: "HartOS: noted; following up." };

// ─── fake ClickUpRestClient (records calls, holds in-memory comments) ─────────
function fakeClient(opts: { card?: { id: string; name: string; status: string } | null; comments?: Array<{ id: string; text: string }> } = {}): {
  client: ClickUpRestClient;
  calls: Array<{ op: string; args: unknown[] }>;
  comments: Array<{ id: string; text: string }>;
} {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const comments = [...(opts.comments ?? [])];
  const card = opts.card === undefined ? { id: TARGET.cardId, name: TARGET.cardName, status: "open" } : opts.card;
  let n = comments.length;
  const client: ClickUpRestClient = {
    async getTask(taskId) { calls.push({ op: "getTask", args: [taskId] }); return card; },
    async listComments(taskId) { calls.push({ op: "listComments", args: [taskId] }); return [...comments]; },
    async createComment(taskId, text) {
      calls.push({ op: "createComment", args: [taskId, text] });
      const id = `c-${++n}`;
      comments.push({ id, text });
      return { id };
    },
    async setStatus(taskId, status) { calls.push({ op: "setStatus", args: [taskId, status] }); },
  };
  return { client, calls, comments };
}

function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  return fn().then((result) => ({ result, logs })).finally(() => { console.log = orig; });
}

describe("clickup-comment client store", () => {
  it("getCard maps a ClickUp task to {id,name}; a missing task is null", async () => {
    assert.deepEqual(await makeClickUpCommentStore(fakeClient().client).getCard("card-123"), {
      id: "card-123",
      name: "Virtual Card API Clarification",
    });
    assert.equal(await makeClickUpCommentStore(fakeClient({ card: null }).client).getCard("nope"), null);
  });

  it("addComment embeds the deterministic hartos-idem marker in the posted body", async () => {
    const { client, calls } = fakeClient();
    const key = clickupCommentIdempotencyKey("card-123", "p-auth");
    const posted = await makeClickUpCommentStore(client).addComment("card-123", "hello", key);
    assert.equal(posted.id, "c-1");
    const create = calls.find((c) => c.op === "createComment")!;
    assert.match(String(create.args[1]), /hello/);
    assert.match(String(create.args[1]), new RegExp(clickupIdempotencyMarker(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("findCommentByIdempotencyKey matches a comment carrying that marker, else null", async () => {
    const key = clickupCommentIdempotencyKey("card-123", "p-auth");
    const withMarker = fakeClient({ comments: [{ id: "c-9", text: `prior\n\n${clickupIdempotencyMarker(key)}` }] });
    assert.deepEqual(await makeClickUpCommentStore(withMarker.client).findCommentByIdempotencyKey("card-123", key), { id: "c-9" });
    const noMarker = fakeClient({ comments: [{ id: "c-9", text: "unrelated" }] });
    assert.equal(await makeClickUpCommentStore(noMarker.client).findCommentByIdempotencyKey("card-123", key), null);
  });
});

describe("runClickUpComment — fail-closed gate (§14, T3 external)", () => {
  it("flag OFF (default, env {}) → refused, NOT executed; attempt + refusal audited; no comment posted", async () => {
    const { client, calls } = fakeClient();
    const { result, logs } = await captureLogs(() =>
      runClickUpComment(PROPOSAL, TARGET, {}, { now: NOW, store: makeClickUpCommentStore(client), hasCapabilityToken: true }),
    );
    assert.equal(result.executed, false);
    assert.equal(calls.some((c) => c.op === "createComment"), false, "must not post when refused");
    assert.ok(logs.some((l) => l.includes("execution_attempt")));
    assert.ok(logs.some((l) => l.includes("execution_refused")));
  });

  it("global kill-switch overrides a 'true' flag → refused, no comment posted", async () => {
    const { client, calls } = fakeClient();
    const { result } = await captureLogs(() =>
      runClickUpComment(PROPOSAL, TARGET, { [CLICKUP_COMMENT_FLAG]: "true", [KILL_SWITCH_ENV]: "on" }, {
        now: NOW, store: makeClickUpCommentStore(client), hasCapabilityToken: true,
      }),
    );
    assert.equal(result.executed, false);
    assert.equal(calls.some((c) => c.op === "createComment"), false);
  });

  it("happy path: flag ON + all preconditions → posts exactly one comment, before/after, reversible, audited", async () => {
    const { client, calls } = fakeClient({ comments: [] });
    const { result, logs } = await captureLogs(() =>
      runClickUpComment(PROPOSAL, TARGET, { [CLICKUP_COMMENT_FLAG]: "true" }, {
        now: NOW, store: makeClickUpCommentStore(client), hasCapabilityToken: true,
      }),
    );
    assert.equal(result.executed, true);
    assert.equal(result.outcome?.reversible, true);
    assert.deepEqual(result.outcome?.before, { comments: 0, idempotentCommentPresent: false });
    assert.equal((result.outcome?.after as Record<string, unknown>).comments, 1);
    assert.equal(calls.filter((c) => c.op === "createComment").length, 1, "exactly one comment posted");
    assert.ok(logs.some((l) => l.includes("executed")));
  });

  it("idempotent: a re-run finds the marker already present → posts 0 (no duplicate)", async () => {
    const key = clickupCommentIdempotencyKey(TARGET.cardId, PROPOSAL.id);
    const { client, calls } = fakeClient({ comments: [{ id: "c-prev", text: `prior\n\n${clickupIdempotencyMarker(key)}` }] });
    const { result } = await captureLogs(() =>
      runClickUpComment(PROPOSAL, TARGET, { [CLICKUP_COMMENT_FLAG]: "true" }, {
        now: NOW, store: makeClickUpCommentStore(client), hasCapabilityToken: true,
      }),
    );
    assert.equal(result.executed, false, "an idempotent no-op did not execute a write");
    assert.equal(result.outcome?.ran, false);
    assert.equal(calls.some((c) => c.op === "createComment"), false, "no duplicate comment");
  });

  it("read-before-write: a missing card refuses, writes nothing", async () => {
    const { client, calls } = fakeClient({ card: null });
    const { result } = await captureLogs(() =>
      runClickUpComment(PROPOSAL, TARGET, { [CLICKUP_COMMENT_FLAG]: "true" }, {
        now: NOW, store: makeClickUpCommentStore(client), hasCapabilityToken: true,
      }),
    );
    assert.equal(result.executed, false);
    assert.match(String(result.outcome?.summary), /not found/i);
    assert.equal(calls.some((c) => c.op === "createComment"), false);
  });

  it("dryRun never writes (preview only)", async () => {
    const { client, calls } = fakeClient({ comments: [] });
    const { result } = await captureLogs(() =>
      runClickUpComment(PROPOSAL, TARGET, { [CLICKUP_COMMENT_FLAG]: "true" }, {
        now: NOW, dryRun: true, store: makeClickUpCommentStore(client), hasCapabilityToken: true,
      }),
    );
    assert.equal(result.executed, false);
    assert.equal(result.outcome?.ran, false);
    assert.equal((result.outcome?.after as Record<string, unknown>).comments, 1, "preview projects the +1");
    assert.equal(calls.some((c) => c.op === "createComment"), false, "preview writes nothing");
  });
});
