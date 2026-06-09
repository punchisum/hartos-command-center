/**
 * tests/run-mark-reviewed-db.test.ts — plan §14 executor store (pg transport) + gated runner.
 *
 * The DB-backed mark-reviewed store mirrors the archive-rejected executor store EXACTLY, with two
 * differences: "reviewed" is a REVERSIBLE jsonb marker (`payload.reviewed=true`) merged onto the
 * existing `payload` column (NOT a new lifecycle status), the target filter is `domain='ops'` not-
 * yet-reviewed, and T2 adds a read-before-write `beforeState` snapshot. These assertions pin the
 * SQL + params via an injected fake Queryable (no live connection): the `domain='ops'` + not-
 * already-reviewed filter, the read-before-write select, the jsonb `||` merge, `RETURNING id`, and
 * the append-only audit insert (`mark_reviewed_executed`). The runner tests reuse the fail-closed
 * gate via a StubStore: flag OFF refuses (store untouched), the kill-switch overrides, the happy
 * path executes once (before/after, with the T2 beforeState present), an all-reviewed re-run reports
 * 0, and dryRun never writes. All hermetic — the timestamp is injected; nothing touches
 * env/network/fs/clock.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeMarkReviewedStore, type Queryable } from "../src/execution/run-mark-reviewed-db.js";
import { runMarkReviewed } from "../src/execution/run-mark-reviewed.js";
import {
  MARK_REVIEWED_FLAG,
  type MarkReviewedStore,
  type ReviewableSnapshot,
} from "../src/execution/adapters/mark-reviewed.js";
import { KILL_SWITCH_ENV } from "../src/execution/execution-adapter.js";

const NOW = "2026-06-09T12:00:00.000Z";
const FUTURE = "2026-06-10T12:00:00.000Z";

function fakeDb(results: Array<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>): {
  db: Queryable;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  let i = 0;
  const db: Queryable = {
    async query(text, params) {
      calls.push({ text, params });
      return results[i++] ?? { rows: [], rowCount: 0 };
    },
  };
  return { db, calls };
}

describe("mark-reviewed DB store", () => {
  it("countReviewableOps selects only domain='ops' + not-yet-reviewed rows and returns the count", async () => {
    const { db, calls } = fakeDb([{ rows: [{ n: 4 }], rowCount: 1 }]);
    const n = await makeMarkReviewedStore(db).countReviewableOps(NOW);
    assert.equal(n, 4);
    assert.match(calls[0]!.text, /select count\(\*\)/i);
    assert.match(calls[0]!.text, /from public\.cockpit_proposals/i);
    assert.match(calls[0]!.text, /domain='ops'/i);
    assert.match(calls[0]!.text, /\(payload->>'reviewed'\) is distinct from 'true'/i);
  });

  it("readReviewableOps reads the T2 read-before-write snapshot (id, status, payload) over the same filter", async () => {
    const { db, calls } = fakeDb([
      { rows: [
        { id: "a", status: "open", payload: { foo: 1 } },
        { id: "b", status: null, payload: null },
      ], rowCount: 2 },
    ]);
    const snap: ReviewableSnapshot[] = await makeMarkReviewedStore(db).readReviewableOps(NOW);
    assert.match(calls[0]!.text, /select id, status, payload from public\.cockpit_proposals/i);
    assert.match(calls[0]!.text, /domain='ops'/i);
    assert.match(calls[0]!.text, /\(payload->>'reviewed'\) is distinct from 'true'/i);
    assert.deepEqual(snap, [
      { id: "a", status: "open", payload: { foo: 1 } },
      { id: "b", status: null, payload: null },
    ]);
  });

  it("markReviewedProposals merges the reversible payload.reviewed marker and returns rowCount", async () => {
    const { db, calls } = fakeDb([{ rows: [{ id: "a" }, { id: "b" }, { id: "c" }], rowCount: 3 }]);
    const reviewed = await makeMarkReviewedStore(db).markReviewedProposals(NOW);
    assert.equal(reviewed, 3);
    // The jsonb || merge — guarded by COALESCE so existing payload keys survive — over the filter.
    assert.match(calls[0]!.text, /update public\.cockpit_proposals set payload = coalesce\(payload,'\{\}'::jsonb\) \|\| '\{"reviewed":true\}'::jsonb/i);
    assert.match(calls[0]!.text, /updated_at=\$1/i);
    assert.match(calls[0]!.text, /domain='ops'/i);
    assert.match(calls[0]!.text, /\(payload->>'reviewed'\) is distinct from 'true'/i);
    assert.match(calls[0]!.text, /returning id/i);
    assert.deepEqual(calls[0]!.params, [NOW]);
  });

  it("stampSync appends one immutable audit row (proposal id, mark_reviewed_executed, reviewed:N, at)", async () => {
    const { db, calls } = fakeDb([{ rows: [], rowCount: 1 }]);
    await makeMarkReviewedStore(db).stampSync("canary-mark-reviewed", NOW, 3);
    assert.match(calls[0]!.text, /insert into public\.cockpit_proposal_audit/i);
    assert.match(calls[0]!.text, /\(proposal_id, event, to_status, at\)/i);
    assert.deepEqual(calls[0]!.params, ["canary-mark-reviewed", "mark_reviewed_executed", "reviewed:3", NOW]);
  });

  it("a re-run that marks nothing reports 0 (idempotent — all ops rows already reviewed)", async () => {
    const { db } = fakeDb([{ rows: [], rowCount: 0 }]);
    assert.equal(await makeMarkReviewedStore(db).markReviewedProposals(NOW), 0);
  });
});

// ─── The gated runner — fail-closed gate over an injected StubStore (no DB) ───────────

interface StubStore extends MarkReviewedStore {
  reviewed: number;
  stamped: number;
  markCalls: number;
  readCalls: number;
}
function makeStore(reviewable = 3): StubStore {
  let reviewableCount = reviewable;
  const s: StubStore = {
    reviewed: 0,
    stamped: 0,
    markCalls: 0,
    readCalls: 0,
    async countReviewableOps() { return reviewableCount; },
    async readReviewableOps() {
      s.readCalls += 1;
      // A real beforeState snapshot of the rows about to be touched (read-before-write).
      return Array.from({ length: reviewableCount }, (_, k) => ({
        id: `ops-${k}`,
        status: "open",
        payload: { reviewed: false } as Record<string, unknown>,
      }));
    },
    async markReviewedProposals() {
      s.markCalls += 1;
      const n = reviewableCount;
      reviewableCount = 0; // marked rows leave the reviewable set → an immediate re-run marks 0
      s.reviewed += n;
      return n;
    },
    async stampSync() { s.stamped += 1; },
  };
  return s;
}

/** Capture the framework audit trace (writeAudit logs via console.log). */
function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  return fn().then((result) => ({ result, logs })).finally(() => { console.log = orig; });
}

describe("runMarkReviewed — fail-closed gate", () => {
  it("flag OFF (default) → refused, NOT executed, store untouched, attempt + refusal audited", async () => {
    const store = makeStore();
    const { result, logs } = await captureLogs(() =>
      runMarkReviewed(
        { id: "p-trigger", status: "approved_for_execution", expiresAt: FUTURE },
        {}, // flag absent ⇒ OFF
        { store, hasCapabilityToken: true, now: NOW },
      ),
    );
    assert.equal(result.executed, false);
    assert.equal(store.markCalls, 0, "must not touch data when refused");
    assert.equal(store.readCalls, 0, "must not even read-before-write when refused");
    assert.equal(store.reviewed, 0);
    assert.equal(store.stamped, 0);
    assert.ok(logs.some((l) => l.includes("execution_attempt")));
    assert.ok(logs.some((l) => l.includes("execution_refused")));
  });

  it("global kill-switch overrides the per-action flag → refused, store untouched", async () => {
    const store = makeStore();
    const { result } = await captureLogs(() =>
      runMarkReviewed(
        { id: "p-trigger", status: "approved_for_execution", expiresAt: FUTURE },
        { [MARK_REVIEWED_FLAG]: "true", [KILL_SWITCH_ENV]: "on" },
        { store, hasCapabilityToken: true, now: NOW },
      ),
    );
    assert.equal(result.executed, false);
    assert.equal(store.markCalls, 0);
  });

  it("happy path: all conditions + flag ON → executes once, reports before/after + T2 beforeState, reversible, audited", async () => {
    const store = makeStore(3);
    const { result, logs } = await captureLogs(() =>
      runMarkReviewed(
        { id: "p-trigger", status: "approved_for_execution", expiresAt: FUTURE },
        { [MARK_REVIEWED_FLAG]: "true" },
        { store, hasCapabilityToken: true, now: NOW },
      ),
    );
    assert.equal(result.executed, true);
    assert.equal(result.outcome?.reversible, true);
    assert.equal((result.outcome?.before as { reviewableOps: number }).reviewableOps, 3);
    assert.deepEqual(result.outcome?.after, { reviewableOps: 0 });
    // T2 read-before-write: a real beforeState snapshot must be surfaced in `before`.
    const beforeState = (result.outcome?.before as { beforeState: ReviewableSnapshot[] }).beforeState;
    assert.equal(store.readCalls, 1, "read-before-write must run exactly once");
    assert.equal(beforeState.length, 3);
    assert.equal(beforeState[0]!.id, "ops-0");
    assert.equal(store.markCalls, 1, "the conditional write must run exactly once");
    assert.equal(store.reviewed, 3);
    assert.equal(store.stamped, 1);
    assert.ok(logs.some((l) => l.includes("executed")));
  });

  it("idempotent re-run: all ops rows already reviewed → marks 0 (still reversible, empty beforeState)", async () => {
    const store = makeStore(0); // nothing reviewable left
    const { result } = await captureLogs(() =>
      runMarkReviewed(
        { id: "p-trigger", status: "approved_for_execution", expiresAt: FUTURE },
        { [MARK_REVIEWED_FLAG]: "true" },
        { store, hasCapabilityToken: true, now: NOW },
      ),
    );
    assert.equal(result.executed, true);
    assert.deepEqual(result.outcome?.after, { reviewableOps: 0 });
    assert.deepEqual((result.outcome?.before as { beforeState: ReviewableSnapshot[] }).beforeState, []);
    assert.equal(store.reviewed, 0);
  });

  it("dryRun never writes (counts only, no read-before-write, no conditional write, no audit row)", async () => {
    const store = makeStore(2);
    const { result } = await captureLogs(() =>
      runMarkReviewed(
        { id: "p-trigger", status: "approved_for_execution", expiresAt: FUTURE },
        { [MARK_REVIEWED_FLAG]: "true" },
        { store, hasCapabilityToken: true, now: NOW, dryRun: true },
      ),
    );
    assert.equal(result.executed, false);
    assert.equal(result.outcome?.ran, false);
    assert.deepEqual(result.outcome?.before, { reviewableOps: 2 });
    assert.equal(store.markCalls, 0);
    assert.equal(store.readCalls, 0);
    assert.equal(store.reviewed, 0);
    assert.equal(store.stamped, 0);
  });
});
