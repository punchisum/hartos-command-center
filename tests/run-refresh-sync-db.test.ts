/**
 * tests/run-refresh-sync-db.test.ts — Phase 3 executor store (pg transport).
 *
 * The DB-backed refresh-sync store must mirror the Edge Function's refresh_sync op EXACTLY:
 * count / expire ONLY past-due draft|pending rows, and write one append-only audit row. These
 * assertions pin the SQL + params via an injected fake Queryable — no live connection.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeRefreshSyncStore, type Queryable } from "../src/execution/run-refresh-sync-db.js";
import { runRefreshSync } from "../src/execution/run-refresh-sync.js";

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

const NOW = "2026-06-08T12:00:00.000Z";

describe("refresh-sync DB store", () => {
  it("countStaleProposals selects only past-due draft|pending rows and returns the count", async () => {
    const { db, calls } = fakeDb([{ rows: [{ n: 3 }], rowCount: 1 }]);
    const n = await makeRefreshSyncStore(db).countStaleProposals(NOW);
    assert.equal(n, 3);
    assert.match(calls[0]!.text, /select count\(\*\)/i);
    assert.match(calls[0]!.text, /from public\.cockpit_proposals/i);
    assert.match(calls[0]!.text, /status in \('draft','pending_approval'\)/i);
    assert.match(calls[0]!.text, /expires_at < \$1/i);
    assert.deepEqual(calls[0]!.params, [NOW]);
  });

  it("expireStaleProposals issues a conditional UPDATE to 'expired' and returns rowCount", async () => {
    const { db, calls } = fakeDb([{ rows: [{ id: "a" }, { id: "b" }], rowCount: 2 }]);
    const expired = await makeRefreshSyncStore(db).expireStaleProposals(NOW);
    assert.equal(expired, 2);
    assert.match(calls[0]!.text, /update public\.cockpit_proposals set status='expired'/i);
    assert.match(calls[0]!.text, /status in \('draft','pending_approval'\)/i);
    assert.match(calls[0]!.text, /expires_at < \$1/i);
    assert.match(calls[0]!.text, /returning id/i);
    assert.deepEqual(calls[0]!.params, [NOW]);
  });

  it("stampSync appends one immutable audit row (proposal id, event, expired:N, at)", async () => {
    const { db, calls } = fakeDb([{ rows: [], rowCount: 1 }]);
    await makeRefreshSyncStore(db).stampSync("canary-refresh-sync", NOW, 2);
    assert.match(calls[0]!.text, /insert into public\.cockpit_proposal_audit/i);
    assert.match(calls[0]!.text, /\(proposal_id, event, to_status, at\)/i);
    assert.deepEqual(calls[0]!.params, ["canary-refresh-sync", "refresh_sync_executed", "expired:2", NOW]);
  });

  it("a re-run that expires nothing reports 0 (idempotent)", async () => {
    const { db } = fakeDb([{ rows: [], rowCount: 0 }]);
    assert.equal(await makeRefreshSyncStore(db).expireStaleProposals(NOW), 0);
  });

  it("getLiveProposalStatus re-reads status + expires_at by id and returns the row", async () => {
    const { db, calls } = fakeDb([{ rows: [{ status: "approved_for_execution", expires_at: null }], rowCount: 1 }]);
    const live = await makeRefreshSyncStore(db).getLiveProposalStatus("p-123");
    assert.deepEqual(live, { status: "approved_for_execution", expiresAt: null });
    assert.match(calls[0]!.text, /select status, expires_at from public\.cockpit_proposals/i);
    assert.match(calls[0]!.text, /where id = \$1/i);
    assert.deepEqual(calls[0]!.params, ["p-123"]);
  });

  it("getLiveProposalStatus returns null when the row does not exist", async () => {
    const { db } = fakeDb([{ rows: [], rowCount: 0 }]);
    assert.equal(await makeRefreshSyncStore(db).getLiveProposalStatus("missing"), null);
  });

  it("getLiveProposalStatus normalizes a Date expires_at to an ISO string", async () => {
    const when = new Date("2026-06-09T00:00:00.000Z");
    const { db } = fakeDb([{ rows: [{ status: "draft", expires_at: when }], rowCount: 1 }]);
    const live = await makeRefreshSyncStore(db).getLiveProposalStatus("p-1");
    assert.deepEqual(live, { status: "draft", expiresAt: "2026-06-09T00:00:00.000Z" });
  });
});

describe("runRefreshSync — live status verification (read-before-write)", () => {
  // Capture the framework audit trace (writeAudit logs via console.log).
  function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    return fn().then((result) => ({ result, logs })).finally(() => { console.log = orig; });
  }

  it("refuses + audits + never writes when the live status mismatches EXECUTABLE_FROM", async () => {
    // The live row is "draft" (not approved). The status read is the first query; the executor
    // must refuse BEFORE issuing any UPDATE, so only the SELECT is ever sent.
    const { db, calls } = fakeDb([{ rows: [{ status: "draft", expires_at: null }], rowCount: 1 }]);
    const store = makeRefreshSyncStore(db);
    const { result, logs } = await captureLogs(() =>
      runRefreshSync(
        { id: "p-mismatch", status: "approved_for_execution", expiresAt: null },
        { ALLOW_EXEC_REFRESH_SYNC: "true" },
        { store, hasCapabilityToken: true },
      ),
    );
    assert.equal(result.executed, false, "must not execute on a live-status mismatch");
    assert.ok(result.precondition.denials.some((d) => d.includes("live target status not verified")));
    // Only the live-status SELECT ran; no UPDATE/INSERT was issued.
    assert.equal(calls.length, 1, "only the live-status read should have run");
    assert.match(calls[0]!.text, /select status, expires_at/i);
    assert.ok(!calls.some((c) => /update |insert into/i.test(c.text)), "no write may be issued");
    assert.ok(logs.some((l) => l.includes("execution_refused")), "the refusal must be audited");
  });

  it("refuses when the live row is missing (no row to confirm)", async () => {
    const { db, calls } = fakeDb([{ rows: [], rowCount: 0 }]);
    const store = makeRefreshSyncStore(db);
    const { result } = await captureLogs(() =>
      runRefreshSync(
        { id: "absent", status: "approved_for_execution", expiresAt: null },
        { ALLOW_EXEC_REFRESH_SYNC: "true" },
        { store, hasCapabilityToken: true },
      ),
    );
    assert.equal(result.executed, false);
    assert.ok(result.precondition.denials.some((d) => d.includes("live target status not verified")));
    assert.ok(!calls.some((c) => /update |insert into/i.test(c.text)), "no write may be issued");
  });
});
