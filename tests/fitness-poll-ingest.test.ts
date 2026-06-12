/**
 * tests/fitness-poll-ingest.test.ts — P5: the cross-repo poller core (poll → ingest).
 *
 * The single core the live-runner invokes each pass: poll the fitness side's pending mutations and
 * ingest each into the spine (idempotent). Over an injected Queryable; the pg pool + the arming
 * gate are the live-runner's thin glue. Hermetic: a fake db answers the poll RPC + the inserts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pollAndIngestFitnessMutations } from "../src/fitness/fitness-poll-ingest.js";

const NOW = new Date("2026-06-12T22:05:00.000Z");
const CTX = { userId: "u-1", agentId: "a-1" };

const PENDING_ROW = {
  state_date: "2026-06-12", recovery_band: "green", recovery_score: 84,
  action: "as-planned", calorie_pct: 10, reason: "Green — fuel.", idempotency_key: "k",
};

/** A fake db that returns pending rows from the poll RPC and accepts the spine inserts. */
function fakeDb(pendingRows: Array<Record<string, unknown>>, existingIds: string[] = []) {
  const existing = new Set(existingIds);
  const inserted: string[] = [];
  const db = {
    async query(text: string, params: unknown[] = []) {
      if (/get_pending_mutations/i.test(text)) return { rows: pendingRows, rowCount: pendingRows.length };
      if (/^insert into public\.cockpit_proposals/i.test(text)) {
        const id = String(params[0]);
        if (existing.has(id)) return { rows: [], rowCount: 0 };
        existing.add(id); inserted.push(id);
        return { rows: [], rowCount: 1 };
      }
      if (/^insert into public\.cockpit_proposal_audit/i.test(text)) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { db, inserted };
}

describe("pollAndIngestFitnessMutations", () => {
  it("polls the fitness side and ingests each pending mutation into the spine", async () => {
    const { db, inserted } = fakeDb([PENDING_ROW]);
    const summary = await pollAndIngestFitnessMutations(db, CTX, NOW);
    assert.equal(summary.polled, 1);
    assert.equal(summary.ingested, 1);
    assert.deepEqual(inserted, ["fitness-2026-06-12-green"]);
  });

  it("re-polling an already-ingested mutation is a no-op (idempotent)", async () => {
    const { db, inserted } = fakeDb([PENDING_ROW], ["fitness-2026-06-12-green"]);
    const summary = await pollAndIngestFitnessMutations(db, CTX, NOW);
    assert.equal(summary.polled, 1);
    assert.equal(summary.ingested, 0);
    assert.equal(summary.skipped, 1);
    assert.equal(inserted.length, 0);
  });

  it("nothing pending → an empty summary", async () => {
    const { db } = fakeDb([]);
    const summary = await pollAndIngestFitnessMutations(db, CTX, NOW);
    assert.deepEqual(summary, { polled: 0, ingested: 0, skipped: 0, ids: [] });
  });
});
