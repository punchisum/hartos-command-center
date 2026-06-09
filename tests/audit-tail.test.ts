/**
 * tests/audit-tail.test.ts — read-only tail over the append-only proposal audit log.
 *
 * Pins the SELECT shape + params via an injected fake Queryable (no live connection) and
 * checks the formatter renders representative rows, including a Date `at` and a null
 * `to_status`. Hermetic: no env, network, fs, or clock.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchAuditTail, formatAuditTail, type AuditRow } from "../src/execution/audit-tail.js";
import type { Queryable } from "../src/execution/run-refresh-sync-db.js";

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

describe("fetchAuditTail", () => {
  it("selects from the audit table, newest-first, limited by $1=[limit]", async () => {
    const { db, calls } = fakeDb([{ rows: [], rowCount: 0 }]);
    await fetchAuditTail(db, 5);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.text, /from public\.cockpit_proposal_audit/i);
    assert.match(calls[0]!.text, /order by at desc/i);
    assert.match(calls[0]!.text, /limit \$1/i);
    assert.match(calls[0]!.text, /select proposal_id, event, to_status, at/i);
    assert.deepEqual(calls[0]!.params, [5]);
  });

  it("maps raw rows into AuditRows, preserving a Date `at` and a null to_status", async () => {
    const when = new Date("2026-06-09T00:00:00.000Z");
    const { db } = fakeDb([
      {
        rows: [
          { proposal_id: "p-1", event: "approved", to_status: "approved_for_execution", at: when },
          { proposal_id: "p-2", event: "refresh_sync_executed", to_status: null, at: "2026-06-08T12:00:00.000Z" },
        ],
        rowCount: 2,
      },
    ]);
    const rows = await fetchAuditTail(db, 2);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { proposalId: "p-1", event: "approved", toStatus: "approved_for_execution", at: when });
    assert.deepEqual(rows[1], {
      proposalId: "p-2",
      event: "refresh_sync_executed",
      toStatus: null,
      at: "2026-06-08T12:00:00.000Z",
    });
  });

  it("returns an empty array when there are no rows", async () => {
    const { db } = fakeDb([{ rows: [], rowCount: 0 }]);
    assert.deepEqual(await fetchAuditTail(db, 10), []);
  });
});

describe("formatAuditTail", () => {
  it("renders representative rows incl. a Date `at` and a null to_status (shown as '-')", () => {
    const rows: AuditRow[] = [
      {
        proposalId: "p-1",
        event: "approved",
        toStatus: "approved_for_execution",
        at: new Date("2026-06-09T00:00:00.000Z"),
      },
      { proposalId: "p-2", event: "refresh_sync_executed", toStatus: null, at: "2026-06-08T12:00:00.000Z" },
    ];
    const out = formatAuditTail(rows);
    const lines = out.split("\n");
    assert.equal(lines.length, 2);
    // Date normalized to ISO.
    assert.match(lines[0]!, /2026-06-09T00:00:00\.000Z/);
    assert.match(lines[0]!, /approved/);
    assert.match(lines[0]!, /approved_for_execution/);
    assert.match(lines[0]!, /p-1/);
    // Null to_status renders as a dash; the source row id is still present.
    assert.match(lines[1]!, /refresh_sync_executed/);
    assert.match(lines[1]!, /\s-\s/);
    assert.match(lines[1]!, /p-2/);
  });

  it("aligns the timestamp/event/to-status columns to a common width", () => {
    const rows: AuditRow[] = [
      { proposalId: "p-1", event: "approved", toStatus: "ok", at: "2026-06-09T00:00:00.000Z" },
      { proposalId: "p-2", event: "rejected_by_human", toStatus: null, at: "2026-06-08T12:00:00.000Z" },
    ];
    const lines = formatAuditTail(rows).split("\n");
    // The id is the last column; the event column is padded so the longest event sets the width,
    // meaning every line's proposal-id begins at the same character offset.
    const offset0 = lines[0]!.indexOf("p-1");
    const offset1 = lines[1]!.indexOf("p-2");
    assert.equal(offset0, offset1);
  });

  it("returns a placeholder for an empty tail", () => {
    assert.equal(formatAuditTail([]), "(no audit rows)");
  });
});
