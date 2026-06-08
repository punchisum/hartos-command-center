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
});
