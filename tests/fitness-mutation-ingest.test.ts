/**
 * tests/fitness-mutation-ingest.test.ts — P5: ingest polled pending mutations into the spine.
 *
 * The live-runner polls get_pending_mutations (fitness side, same DB) and ingests each as a
 * ProposalQueueItem into cockpit_proposals. Idempotent by the deterministic proposal id (ON
 * CONFLICT DO NOTHING) so re-polling the same pending mutation never duplicates. PURE-ish core over
 * an injected Queryable (a fake here; the pg handle on the host). The RPC poll itself is host glue.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestPendingFitnessMutations } from "../src/fitness/fitness-mutation-ingest.js";
import type { PendingFitnessMutation } from "../src/fitness/fitness-mutation-materialize.js";

const NOW = new Date("2026-06-12T22:05:00.000Z");
const M = (band: "green" | "amber" | "red"): PendingFitnessMutation => ({
  stateDate: "2026-06-12", recoveryBand: band, recoveryScore: 70, action: "controlled", caloriePct: 0, reason: "r", idempotencyKey: `2026-06-12:${band}`,
});

function fakeDb(existingIds: string[] = []) {
  const inserts: Array<{ id: string; status: string; domain: string }> = [];
  const audits: Array<{ id: string; event: string }> = [];
  const existing = new Set(existingIds);
  return {
    inserts, audits,
    db: {
      async query(text: string, params: unknown[] = []) {
        if (/^insert into public\.cockpit_proposals/i.test(text)) {
          const id = String(params[0]);
          if (existing.has(id)) return { rows: [], rowCount: 0 }; // ON CONFLICT DO NOTHING
          existing.add(id);
          inserts.push({ id, domain: String(params[1]), status: String(params[5]) });
          return { rows: [], rowCount: 1 };
        }
        if (/^insert into public\.cockpit_proposal_audit/i.test(text)) {
          const m = /values\s*\(\$1,\s*'([a-z_]+)'/i.exec(text);
          audits.push({ id: String(params[0]), event: m ? m[1] : "?" });
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`unexpected query: ${text}`);
      },
    },
  };
}

describe("ingestPendingFitnessMutations", () => {
  it("materialises + inserts each pending mutation as a pending_approval fitness proposal", async () => {
    const { db, inserts, audits } = fakeDb();
    const summary = await ingestPendingFitnessMutations(db, [M("green"), M("amber")], NOW);
    assert.equal(summary.ingested, 2);
    assert.equal(summary.skipped, 0);
    assert.equal(inserts.length, 2);
    assert.ok(inserts.every((r) => r.domain === "fitness" && r.status === "pending_approval"));
    assert.deepEqual(summary.ids.sort(), ["fitness-2026-06-12-amber", "fitness-2026-06-12-green"]);
    assert.ok(audits.some((a) => a.event === "fitness_materialized"));
  });

  it("is idempotent: a pending mutation whose proposal already exists is skipped (no duplicate)", async () => {
    const { db, inserts } = fakeDb(["fitness-2026-06-12-green"]);
    const summary = await ingestPendingFitnessMutations(db, [M("green")], NOW);
    assert.equal(summary.ingested, 0);
    assert.equal(summary.skipped, 1);
    assert.equal(inserts.length, 0, "no insert for an already-present proposal");
  });

  it("returns an empty summary for no pending mutations", async () => {
    const { db } = fakeDb();
    const summary = await ingestPendingFitnessMutations(db, [], NOW);
    assert.deepEqual(summary, { ingested: 0, skipped: 0, ids: [] });
  });
});
