/**
 * tests/run-archive-rejected-db.test.ts — plan §14 executor store (pg transport) + gated runner.
 *
 * The DB-backed archive-rejected store mirrors the refresh-sync executor store EXACTLY, with one
 * difference: archival is a REVERSIBLE jsonb marker (`payload.archived=true`) merged onto the
 * existing `payload` column — NOT a new lifecycle status. These assertions pin the SQL + params via
 * an injected fake Queryable (no live connection): the `rejected` + not-already-archived filter, the
 * jsonb `||` merge, `RETURNING id`, and the append-only audit insert. The runner tests reuse the
 * fail-closed gate via a StubStore: flag OFF refuses (store untouched), the kill-switch overrides,
 * the happy path executes once (before/after), an all-archived re-run reports 0, and dryRun never
 * writes. All hermetic — the timestamp is injected; nothing touches env/network/fs/clock.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeArchiveRejectedStore, type Queryable } from "../src/execution/run-archive-rejected-db.js";
import { runArchiveRejected } from "../src/execution/run-archive-rejected.js";
import {
  ARCHIVE_REJECTED_FLAG,
  type ArchiveRejectedStore,
} from "../src/execution/adapters/archive-rejected.js";
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

describe("archive-rejected DB store", () => {
  it("countArchivableRejected selects only rejected + not-yet-archived rows and returns the count", async () => {
    const { db, calls } = fakeDb([{ rows: [{ n: 4 }], rowCount: 1 }]);
    const n = await makeArchiveRejectedStore(db).countArchivableRejected(NOW);
    assert.equal(n, 4);
    assert.match(calls[0]!.text, /select count\(\*\)/i);
    assert.match(calls[0]!.text, /from public\.cockpit_proposals/i);
    assert.match(calls[0]!.text, /status='rejected'/i);
    assert.match(calls[0]!.text, /\(payload->>'archived'\) is distinct from 'true'/i);
  });

  it("archiveRejectedProposals merges the reversible payload.archived marker and returns rowCount", async () => {
    const { db, calls } = fakeDb([{ rows: [{ id: "a" }, { id: "b" }, { id: "c" }], rowCount: 3 }]);
    const archived = await makeArchiveRejectedStore(db).archiveRejectedProposals(NOW);
    assert.equal(archived, 3);
    // The jsonb || merge — guarded by COALESCE so existing payload keys survive — over the filter.
    assert.match(calls[0]!.text, /update public\.cockpit_proposals set payload = coalesce\(payload,'\{\}'::jsonb\) \|\| '\{"archived":true\}'::jsonb/i);
    assert.match(calls[0]!.text, /updated_at=\$1/i);
    assert.match(calls[0]!.text, /status='rejected'/i);
    assert.match(calls[0]!.text, /\(payload->>'archived'\) is distinct from 'true'/i);
    assert.match(calls[0]!.text, /returning id/i);
    assert.deepEqual(calls[0]!.params, [NOW]);
  });

  it("stampSync appends one immutable audit row (proposal id, archive_rejected_executed, archived:N, at)", async () => {
    const { db, calls } = fakeDb([{ rows: [], rowCount: 1 }]);
    await makeArchiveRejectedStore(db).stampSync("canary-archive-rejected", NOW, 3);
    assert.match(calls[0]!.text, /insert into public\.cockpit_proposal_audit/i);
    assert.match(calls[0]!.text, /\(proposal_id, event, to_status, at\)/i);
    assert.deepEqual(calls[0]!.params, ["canary-archive-rejected", "archive_rejected_executed", "archived:3", NOW]);
  });

  it("a re-run that archives nothing reports 0 (idempotent — all rejected rows already marked)", async () => {
    const { db } = fakeDb([{ rows: [], rowCount: 0 }]);
    assert.equal(await makeArchiveRejectedStore(db).archiveRejectedProposals(NOW), 0);
  });
});

// ─── The gated runner — fail-closed gate over an injected StubStore (no DB) ───────────

interface StubStore extends ArchiveRejectedStore {
  archived: number;
  stamped: number;
  archiveCalls: number;
}
function makeStore(archivable = 3): StubStore {
  let archivableCount = archivable;
  const s: StubStore = {
    archived: 0,
    stamped: 0,
    archiveCalls: 0,
    async countArchivableRejected() { return archivableCount; },
    async archiveRejectedProposals() {
      s.archiveCalls += 1;
      const n = archivableCount;
      archivableCount = 0; // marked rows leave the archivable set → an immediate re-run archives 0
      s.archived += n;
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

describe("runArchiveRejected — fail-closed gate", () => {
  it("flag OFF (default) → refused, NOT executed, store untouched, attempt + refusal audited", async () => {
    const store = makeStore();
    const { result, logs } = await captureLogs(() =>
      runArchiveRejected(
        { id: "p-trigger", status: "approved_for_execution", expiresAt: FUTURE },
        {}, // flag absent ⇒ OFF
        { store, hasCapabilityToken: true, now: NOW },
      ),
    );
    assert.equal(result.executed, false);
    assert.equal(store.archiveCalls, 0, "must not touch data when refused");
    assert.equal(store.archived, 0);
    assert.equal(store.stamped, 0);
    assert.ok(logs.some((l) => l.includes("execution_attempt")));
    assert.ok(logs.some((l) => l.includes("execution_refused")));
  });

  it("global kill-switch overrides the per-action flag → refused, store untouched", async () => {
    const store = makeStore();
    const { result } = await captureLogs(() =>
      runArchiveRejected(
        { id: "p-trigger", status: "approved_for_execution", expiresAt: FUTURE },
        { [ARCHIVE_REJECTED_FLAG]: "true", [KILL_SWITCH_ENV]: "on" },
        { store, hasCapabilityToken: true, now: NOW },
      ),
    );
    assert.equal(result.executed, false);
    assert.equal(store.archiveCalls, 0);
  });

  it("happy path: all conditions + flag ON → executes once, reports before/after, reversible, audited", async () => {
    const store = makeStore(3);
    const { result, logs } = await captureLogs(() =>
      runArchiveRejected(
        { id: "p-trigger", status: "approved_for_execution", expiresAt: FUTURE },
        { [ARCHIVE_REJECTED_FLAG]: "true" },
        { store, hasCapabilityToken: true, now: NOW },
      ),
    );
    assert.equal(result.executed, true);
    assert.equal(result.outcome?.reversible, true);
    assert.deepEqual(result.outcome?.before, { archivableRejected: 3 });
    assert.deepEqual(result.outcome?.after, { archivableRejected: 0 });
    assert.equal(store.archiveCalls, 1, "the conditional write must run exactly once");
    assert.equal(store.archived, 3);
    assert.equal(store.stamped, 1);
    assert.ok(logs.some((l) => l.includes("executed")));
  });

  it("idempotent re-run: all rejected rows already archived → archives 0 (still reversible)", async () => {
    const store = makeStore(0); // nothing archivable left
    const { result } = await captureLogs(() =>
      runArchiveRejected(
        { id: "p-trigger", status: "approved_for_execution", expiresAt: FUTURE },
        { [ARCHIVE_REJECTED_FLAG]: "true" },
        { store, hasCapabilityToken: true, now: NOW },
      ),
    );
    assert.equal(result.executed, true);
    assert.deepEqual(result.outcome?.after, { archivableRejected: 0 });
    assert.equal(store.archived, 0);
  });

  it("dryRun never writes (counts only, no conditional write, no audit row)", async () => {
    const store = makeStore(2);
    const { result } = await captureLogs(() =>
      runArchiveRejected(
        { id: "p-trigger", status: "approved_for_execution", expiresAt: FUTURE },
        { [ARCHIVE_REJECTED_FLAG]: "true" },
        { store, hasCapabilityToken: true, now: NOW, dryRun: true },
      ),
    );
    assert.equal(result.executed, false);
    assert.equal(result.outcome?.ran, false);
    assert.deepEqual(result.outcome?.before, { archivableRejected: 2 });
    assert.equal(store.archiveCalls, 0);
    assert.equal(store.archived, 0);
    assert.equal(store.stamped, 0);
  });
});
