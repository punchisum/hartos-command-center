import { test } from "node:test";
import assert from "node:assert/strict";
import { recordDecisionOutcomes, type OutcomesDb } from "../src/learning/record-decision-outcomes.js";

/**
 * A fake OutcomesDb that:
 *  - answers the SELECT of executed proposals with a fixed row set, and
 *  - records every INSERT into cockpit_decision_outcomes (so we can assert the scored rows),
 *  - optionally throws a 42P01-style error from the INSERT to simulate the gated table being absent.
 */
function fakeDb(opts: {
  executedRows: Array<{ id: string; payload: unknown }>;
  insertThrows?: Error;
}): OutcomesDb & { selects: string[]; inserts: unknown[][] } {
  const selects: string[] = [];
  const inserts: unknown[][] = [];
  return {
    selects,
    inserts,
    query: async (text: string, params?: unknown[]) => {
      if (/insert into public\.cockpit_decision_outcomes/i.test(text)) {
        if (opts.insertThrows) throw opts.insertThrows;
        inserts.push(params ?? []);
        return { rows: [] as unknown[] };
      }
      // the SELECT of executed proposals
      selects.push(text);
      return { rows: opts.executedRows as unknown[] };
    },
  };
}

const NOW = "2026-06-15T00:00:00Z";

test("selects executed proposals and scores resolved/persisted/unknown, inserting the right rows", async () => {
  // target-a is GONE from currentSubjects ⇒ resolved.
  // target-b is STILL present (substring match on a current subject) ⇒ persisted.
  // a payload with no targetId/targetName carries no subject ⇒ skipped entirely (not scored).
  const db = fakeDb({
    executedRows: [
      { id: "p1", payload: { actionType: "git_commit", targetId: "target-a" } },
      { id: "p2", payload: { actionType: "vault_write", targetName: "target-b" } },
      { id: "p3", payload: { actionType: "noop" } }, // no subject → skipped
    ],
  });
  const currentSubjects = ["wolverine: target-b is still drifting", "some other finding"];

  const res = await recordDecisionOutcomes(db, currentSubjects, NOW);

  // It issued the SELECT against cockpit_proposals status='executed'.
  assert.equal(db.selects.length, 1);
  assert.match(db.selects[0], /from public\.cockpit_proposals where status='executed'/);

  // p3 (no subject) was skipped; p1 + p2 were scored + inserted.
  assert.equal(res.scored.length, 2);
  assert.equal(res.written, 2);
  assert.equal(res.tableMissing, false);

  const byId = new Map(res.scored.map((s) => [s.proposalId, s]));
  assert.equal(byId.get("p1")?.outcome, "resolved"); // target-a gone
  assert.equal(byId.get("p2")?.outcome, "persisted"); // target-b still present (substring)

  // INSERT params are [proposal_id, action_type, subject, outcome] in order.
  assert.equal(db.inserts.length, 2);
  const insertP1 = db.inserts.find((p) => p[0] === "p1")!;
  assert.deepEqual(insertP1, ["p1", "git_commit", "target-a", "resolved"]);
  const insertP2 = db.inserts.find((p) => p[0] === "p2")!;
  assert.deepEqual(insertP2, ["p2", "vault_write", "target-b", "persisted"]);

  // Summary reflects the tally honestly.
  assert.match(res.summary, /scored 2 executed proposal\(s\)/);
  assert.match(res.summary, /1 resolved/);
  assert.match(res.summary, /1 persisted/);
});

test("honest no-op when there are no recently-executed targeted proposals", async () => {
  const db = fakeDb({ executedRows: [] });
  const res = await recordDecisionOutcomes(db, ["anything"], NOW);
  assert.equal(res.written, 0);
  assert.equal(res.scored.length, 0);
  assert.equal(res.tableMissing, false);
  assert.match(res.summary, /no recently-executed targeted proposals to score/);
  assert.equal(db.inserts.length, 0);
});

test("scores an empty subject as unknown (never guesses)", async () => {
  // A proposal whose subject is whitespace-only still carries no measurable subject and is skipped
  // at selection; to exercise the 'unknown' branch we use a subject that is present but scores via
  // the pure classifier: an empty-after-trim subject ⇒ unknown. We feed it via targetId of spaces.
  const db = fakeDb({
    executedRows: [{ id: "p9", payload: { actionType: "x", targetId: "   " } }],
  });
  // targetId of only spaces is falsy-after-trim? It's truthy as a string, so it's selected, then the
  // pure classifier norms it to "" ⇒ unknown.
  const res = await recordDecisionOutcomes(db, ["whatever"], NOW);
  assert.equal(res.scored.length, 1);
  assert.equal(res.scored[0].outcome, "unknown");
  assert.equal(res.written, 1);
  assert.match(res.summary, /1 unknown/);
});

test("no-ops honestly when the outcomes table is absent (42P01)", async () => {
  const err = new Error('relation "public.cockpit_decision_outcomes" does not exist');
  // pg attaches a .code; our matcher keys on the message family, which includes this string.
  (err as Error & { code?: string }).code = "42P01";
  const db = fakeDb({
    executedRows: [{ id: "p1", payload: { actionType: "git_commit", targetId: "target-a" } }],
    insertThrows: err,
  });

  const res = await recordDecisionOutcomes(db, ["unrelated"], NOW);

  // Scored (the pure classifier ran) but wrote nothing — honest no-op, not a throw.
  assert.equal(res.tableMissing, true);
  assert.equal(res.written, 0);
  assert.equal(res.scored.length, 1);
  assert.match(res.summary, /outcomes table not present/);
  assert.match(res.summary, /20260611011110_cockpit_decision_outcomes\.sql/);
});

test("re-throws a non-42P01 insert failure for the caller to isolate", async () => {
  const err = new Error("connection reset by peer");
  const db = fakeDb({
    executedRows: [{ id: "p1", payload: { actionType: "git_commit", targetId: "target-a" } }],
    insertThrows: err,
  });
  await assert.rejects(() => recordDecisionOutcomes(db, ["unrelated"], NOW), /connection reset by peer/);
});
