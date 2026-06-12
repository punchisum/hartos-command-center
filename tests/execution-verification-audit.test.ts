/**
 * tests/execution-verification-audit.test.ts — P3: persist the post-execution verification verdict.
 *
 * After a write is verified (DispatchResult.verification), the host executor records ONE immutable
 * `execution_verification` row on cockpit_proposal_audit: to_status = landed|unverified, detail =
 * the verdict's human-readable reason. Null verification (adapter has no re-verify path) ⇒ no row.
 * Append-only by construction (INSERT only). Hermetic: a fake Queryable captures the SQL + params.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recordExecutionVerification } from "../src/execution/execution-verification-audit.js";

function fakeDb() {
  const inserts: Array<{ text: string; params: unknown[] }> = [];
  return {
    inserts,
    db: {
      async query(text: string, params: unknown[] = []) {
        inserts.push({ text, params });
        return { rows: [], rowCount: 1 };
      },
    },
  };
}

describe("recordExecutionVerification — append-only execution_verification audit row", () => {
  it("records a 'landed' row when the write was verified to have landed", async () => {
    const { db, inserts } = fakeDb();
    const wrote = await recordExecutionVerification(db, "p-1", { landed: true, detail: 'card reached "on hold"' });
    assert.equal(wrote, true);
    assert.equal(inserts.length, 1);
    assert.match(inserts[0]!.text, /insert into public\.cockpit_proposal_audit/i);
    assert.match(inserts[0]!.text, /execution_verification/);
    assert.deepEqual(inserts[0]!.params, ["p-1", "landed", 'card reached "on hold"']);
  });

  it("records an 'unverified' row when the change did NOT land (fail-closed verdict)", async () => {
    const { db, inserts } = fakeDb();
    const wrote = await recordExecutionVerification(db, "p-2", { landed: false, detail: "post-write re-read failed" });
    assert.equal(wrote, true);
    assert.equal(inserts.length, 1);
    assert.deepEqual(inserts[0]!.params, ["p-2", "unverified", "post-write re-read failed"]);
  });

  it("is a no-op when there is no verification (adapter has no re-verify path) — returns false, writes nothing", async () => {
    const { db, inserts } = fakeDb();
    const wrote = await recordExecutionVerification(db, "p-3", null);
    assert.equal(wrote, false);
    assert.equal(inserts.length, 0);
  });
});
