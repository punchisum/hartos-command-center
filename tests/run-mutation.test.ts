/**
 * tests/run-mutation.test.ts — the gated "fire ONE mutation" CLI (§12).
 *
 * All hermetic (injected Date, injected fake stores via `storeOverride`, no env/network/fs). The
 * CLI core `runMutationCli` returns `{ exitCode, lines, result }`, so we inject a fake store/client
 * (the same fakes the dispatcher test uses) and assert on the captured output + the store calls.
 *
 * Cover:
 *  1. dry-run never writes + emits no delta,
 *  2. flag-OFF --execute → honest refusal, no write,
 *  3. happy path (injected store + armed flag + --execute) → executes once, delta present,
 *  4. unknown / missing args → safe error exit (no throw),
 *  5. "not configured" (store builder returns null) → honest exit 0 (no throw).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runMutationCli } from "../scripts/run-mutation.js";
import { makeClickUpCommentStore, type ClickUpRestClient } from "../src/execution/clickup-client.js";
import { CLICKUP_COMMENT_FLAG } from "../src/execution/adapters/clickup-comment.js";
import { REJECT_DRAFTS_FLAG, type RejectDraftsStore } from "../src/execution/adapters/reject-drafts.js";
import { KILL_SWITCH_ENV } from "../src/execution/execution-adapter.js";

const NOW = new Date("2026-06-09T12:00:00.000Z");
const CARD = { id: "card-123", name: "Virtual Card API Clarification" };

// ─── fake ClickUpRestClient (records calls, holds in-memory comments) — mirrors the dispatcher
//     test's fake so the CLI core exercises a real store seam without network. ─────────────────
function fakeClient(status: string | null = "open", comments: Array<{ id: string; text: string }> = []): {
  client: ClickUpRestClient;
  calls: Array<{ op: string; args: unknown[] }>;
} {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const list = [...comments];
  let n = list.length;
  const client: ClickUpRestClient = {
    async getTask(taskId) { calls.push({ op: "getTask", args: [taskId] }); return status === null ? null : { id: CARD.id, name: CARD.name, status }; },
    async listComments(taskId) { calls.push({ op: "listComments", args: [taskId] }); return [...list]; },
    async createComment(taskId, text) { calls.push({ op: "createComment", args: [taskId, text] }); const id = `c-${++n}`; list.push({ id, text }); return { id }; },
    async setStatus(taskId, s) { calls.push({ op: "setStatus", args: [taskId, s] }); },
  };
  return { client, calls };
}

// ─── fake reject-drafts store (counts/rejects in memory; records the executed count) ──────────
function fakeRejectStore(drafts = 3): RejectDraftsStore & { rejected: number; stamped: number } {
  let count = drafts;
  const s = {
    rejected: 0,
    stamped: 0,
    async countRejectableDrafts() { return count; },
    async rejectDraftProposals() { const k = count; count = 0; s.rejected += k; return k; },
    async stampSync() { s.stamped += 1; },
  };
  return s;
}

const COMMENT_ARGS = ["--adapter", "clickup-comment", "--card", CARD.id, "--proposal", "p-auth", "--text", "HartOS: noted"];

describe("runMutationCli — gated fire-one-mutation CLI (§12)", () => {
  it("(1) dry-run (default) never writes + emits no delta", async () => {
    const { client, calls } = fakeClient("open", []);
    const res = await runMutationCli({
      argv: COMMENT_ARGS, // no --execute
      env: { [CLICKUP_COMMENT_FLAG]: "true" },
      storeOverride: { store: makeClickUpCommentStore(client) },
      now: NOW,
    });
    assert.equal(res.exitCode, 0);
    assert.equal(res.result?.result.executed, false, "dry-run does not execute");
    assert.equal(res.result?.delta, null, "dry-run projects no delta");
    assert.equal(calls.some((c) => c.op === "createComment"), false, "dry-run writes nothing");
    assert.ok(res.lines.some((l) => l.includes("dry-run")), "header announces dry-run mode");
    assert.ok(res.lines.some((l) => l.startsWith("Dry-run:")));
  });

  it("(2) flag OFF + --execute → honest refusal by the gate, no write, non-zero exit", async () => {
    const { client, calls } = fakeClient("open", []);
    const res = await runMutationCli({
      argv: [...COMMENT_ARGS, "--execute"],
      env: {}, // flag absent ⇒ OFF
      storeOverride: { store: makeClickUpCommentStore(client) },
      now: NOW,
    });
    assert.equal(res.exitCode, 2, "a refusal exits non-zero (2)");
    assert.equal(res.result?.result.executed, false);
    assert.equal(res.result?.delta, null, "a refusal emits no delta");
    assert.equal(calls.some((c) => c.op === "createComment"), false, "nothing written when refused");
    assert.ok(res.lines.some((l) => l.startsWith("REFUSED")), "refusal is surfaced honestly");
    assert.ok(res.lines.some((l) => l.includes("allowlist")), "names the unarmed-flag denial");
  });

  it("(2b) global kill-switch overrides a 'true' flag → refused, no write", async () => {
    const { client, calls } = fakeClient("open", []);
    const res = await runMutationCli({
      argv: [...COMMENT_ARGS, "--execute"],
      env: { [CLICKUP_COMMENT_FLAG]: "true", [KILL_SWITCH_ENV]: "on" },
      storeOverride: { store: makeClickUpCommentStore(client) },
      now: NOW,
    });
    assert.equal(res.exitCode, 2);
    assert.equal(res.result?.result.executed, false);
    assert.equal(calls.some((c) => c.op === "createComment"), false);
    assert.ok(res.lines.some((l) => l.includes("BLOCKS ALL execution")), "kill-switch state surfaced by name");
  });

  it("(3) happy path: injected store + armed flag + --execute → executes once, delta present", async () => {
    const { client, calls } = fakeClient("open", []);
    const res = await runMutationCli({
      argv: [...COMMENT_ARGS, "--execute"],
      env: { [CLICKUP_COMMENT_FLAG]: "true" },
      storeOverride: { store: makeClickUpCommentStore(client) },
      now: NOW,
    });
    assert.equal(res.exitCode, 0);
    assert.equal(res.result?.result.executed, true, "armed + approved → executes");
    assert.equal(calls.filter((c) => c.op === "createComment").length, 1, "exactly one write");
    assert.ok(res.result?.delta, "an executed write projects a delta");
    assert.equal(res.result?.delta?.domain, "ops");
    assert.equal(res.result?.delta?.actionType, "ops_followup_plan");
    assert.equal(res.result?.delta?.auditId, "p-auth");
    assert.ok(res.lines.some((l) => l.startsWith("EXECUTED:")));
    assert.ok(res.lines.some((l) => l.includes("StateDelta projected")), "delta summarized in output");
  });

  it("(3b) happy path also works for an internal adapter (reject-drafts) via injected store", async () => {
    const store = fakeRejectStore(3);
    const res = await runMutationCli({
      argv: ["--adapter", "reject-drafts", "--proposal", "p-auth", "--execute"],
      env: { [REJECT_DRAFTS_FLAG]: "true" },
      storeOverride: { store },
      now: NOW,
    });
    assert.equal(res.exitCode, 0);
    assert.equal(res.result?.result.executed, true);
    assert.equal(store.rejected, 3, "the injected store executed exactly once");
    assert.equal(store.stamped, 1, "the durable audit stamp was written once");
    assert.equal(res.result?.delta?.domain, "system");
    assert.equal(res.result?.delta?.actionType, "sync_repair_plan");
  });

  it("(3c) close() is always called (pg pool teardown), even on the happy path", async () => {
    let closed = 0;
    const store = fakeRejectStore(1);
    await runMutationCli({
      argv: ["--adapter", "reject-drafts", "--proposal", "p-auth", "--execute"],
      env: { [REJECT_DRAFTS_FLAG]: "true" },
      storeOverride: { store, close: async () => { closed += 1; } },
      now: NOW,
    });
    assert.equal(closed, 1, "the resolved store's close() ran exactly once");
  });

  it("(4a) unknown adapter → safe error exit (no throw), usage printed", async () => {
    const res = await runMutationCli({ argv: ["--adapter", "delete-everything", "--proposal", "p"], env: {}, now: NOW });
    assert.equal(res.exitCode, 2);
    assert.equal(res.result, undefined, "no command ran");
    assert.ok(res.lines.some((l) => l.startsWith("Unknown adapter")));
    assert.ok(res.lines.some((l) => l.startsWith("Usage:")));
  });

  it("(4b) missing required arg (no --proposal) → safe error exit (no throw)", async () => {
    const { client, calls } = fakeClient("open", []);
    const res = await runMutationCli({
      argv: ["--adapter", "clickup-comment", "--card", CARD.id, "--text", "hi"], // no --proposal
      env: { [CLICKUP_COMMENT_FLAG]: "true" },
      storeOverride: { store: makeClickUpCommentStore(client) },
      now: NOW,
    });
    assert.equal(res.exitCode, 2);
    assert.equal(res.result, undefined, "no command ran");
    assert.ok(res.lines.some((l) => l.includes("Missing required argument") && l.includes("--proposal")));
    assert.equal(calls.some((c) => c.op === "createComment"), false, "nothing written on an arg error");
  });

  it("(4c) missing --adapter entirely → safe error exit (no throw)", async () => {
    const res = await runMutationCli({ argv: ["--proposal", "p"], env: {}, now: NOW });
    assert.equal(res.exitCode, 2);
    assert.ok(res.lines.some((l) => l.includes("Missing required --adapter")));
  });

  it("(5) not configured (store builder returns null) → honest exit 0, no throw", async () => {
    // storeOverride with an explicit null store models the env-builder returning null (no cred).
    let closed = 0;
    const res = await runMutationCli({
      argv: [...COMMENT_ARGS, "--execute"],
      env: {},
      storeOverride: { store: null, close: async () => { closed += 1; } },
      now: NOW,
    });
    assert.equal(res.exitCode, 0, "not-configured is not an error");
    assert.equal(res.result, undefined, "no command ran");
    assert.ok(res.lines.some((l) => l.includes("not configured") && l.includes("CLICKUP_API_TOKEN")), "names the missing cred ENV");
    assert.equal(closed, 1, "close() still runs on the not-configured path");
  });
});
