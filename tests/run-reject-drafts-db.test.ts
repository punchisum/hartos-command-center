/**
 * tests/run-reject-drafts-db.test.ts — plan §14 (T0 gated reject-drafts).
 *
 * Two halves, both hermetic (injected timestamp, fake Queryable/StubStore, no env/network/fs):
 *  1. The DB-backed store pins the SQL + params via an injected fake Queryable — `status='draft'`
 *     only, `RETURNING id`, one append-only audit row (`reject_drafts_executed` → `rejected`).
 *  2. `runRejectDrafts` is fail-closed: flag OFF (default) refuses (attempt + refusal audited,
 *     store untouched), the global kill-switch overrides a 'true' flag, the happy path executes
 *     once with before/after, a re-run on an empty set rejects 0, and dryRun never writes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeRejectDraftsStore, type Queryable } from "../src/execution/run-reject-drafts-db.js";
import { runRejectDrafts } from "../src/execution/run-reject-drafts.js";
import { REJECT_DRAFTS_FLAG, type RejectDraftsStore } from "../src/execution/adapters/reject-drafts.js";
import { KILL_SWITCH_ENV } from "../src/execution/execution-adapter.js";

const NOW = "2026-06-08T12:00:00.000Z";

// The number of bind parameters a SQL statement requires = its highest $N reference
// (0 when there are no placeholders). node-postgres/Postgres reject a Bind whose supplied
// param count differs from this — so mirroring it here lets the fake catch the exact
// mismatch the live runner hit ("bind message supplies 1 parameters, … requires 0").
function requiredParamCount(text: string): number {
  const refs = text.match(/\$(\d+)/g);
  return refs ? Math.max(...refs.map((r) => Number(r.slice(1)))) : 0;
}

// ─── fake Queryable (mirrors the refresh-sync fakeDb spy) ─────────────────────
// The spy enforces placeholder/param parity the way real Postgres does, so a query whose
// supplied param count drifts from its $N placeholders fails the test instead of silently
// passing (which is how the reject-drafts count bug reached the live runner undetected).
function fakeDb(results: Array<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>): {
  db: Queryable;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  let i = 0;
  const db: Queryable = {
    async query(text, params) {
      const required = requiredParamCount(text);
      const supplied = params?.length ?? 0;
      if (supplied !== required) {
        throw new Error(
          `bind message supplies ${supplied} parameters, but prepared statement "" requires ${required}`,
        );
      }
      calls.push({ text, params });
      return results[i++] ?? { rows: [], rowCount: 0 };
    },
  };
  return { db, calls };
}

// ─── StubStore for the gate behaviors (mirrors execution-adapter.test.ts) ─────
interface StubStore extends RejectDraftsStore { rejected: number; stamped: number; }
function makeStore(drafts = 3): StubStore {
  let draftCount = drafts;
  const s: StubStore = {
    rejected: 0,
    stamped: 0,
    async countRejectableDrafts() { return draftCount; },
    async rejectDraftProposals() { const n = draftCount; draftCount = 0; s.rejected += n; return n; },
    async stampSync() { s.stamped += 1; },
  };
  return s;
}

// Capture the framework audit trace (writeAudit logs via console.log).
function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  return fn().then((result) => ({ result, logs })).finally(() => { console.log = orig; });
}

const APPROVED = { id: "p-auth", status: "approved_for_execution" as const, expiresAt: null };

describe("reject-drafts DB store", () => {
  it("countRejectableDrafts selects only status='draft' rows and returns the count", async () => {
    const { db, calls } = fakeDb([{ rows: [{ n: 4 }], rowCount: 1 }]);
    const n = await makeRejectDraftsStore(db).countRejectableDrafts(NOW);
    assert.equal(n, 4);
    assert.match(calls[0]!.text, /select count\(\*\)/i);
    assert.match(calls[0]!.text, /from public\.cockpit_proposals/i);
    assert.match(calls[0]!.text, /status='draft'/i);
  });

  it("countRejectableDrafts supplies NO bind params — its SQL has no $N placeholders (regression: 'bind supplies 1, requires 0')", async () => {
    // The count filter is a literal (status='draft'); passing `now` as a bind param made
    // Postgres reject the Bind every reconcile cycle. The parity-checking fakeDb makes a
    // recurrence fail here instead of only in the live runner.
    const { db, calls } = fakeDb([{ rows: [{ n: 0 }], rowCount: 1 }]);
    await makeRejectDraftsStore(db).countRejectableDrafts(NOW);
    assert.doesNotMatch(calls[0]!.text, /\$\d/, "the count SQL must contain no $N placeholders");
    assert.ok(
      calls[0]!.params === undefined || calls[0]!.params.length === 0,
      "the count query must supply zero bind params to match its zero placeholders",
    );
  });

  it("rejectDraftProposals issues a conditional UPDATE to 'rejected' on draft rows and returns rowCount", async () => {
    const { db, calls } = fakeDb([{ rows: [{ id: "a" }, { id: "b" }], rowCount: 2 }]);
    const rejected = await makeRejectDraftsStore(db).rejectDraftProposals(NOW);
    assert.equal(rejected, 2);
    assert.match(calls[0]!.text, /update public\.cockpit_proposals set status='rejected'/i);
    assert.match(calls[0]!.text, /where status='draft'/i);
    assert.match(calls[0]!.text, /returning id/i);
    assert.deepEqual(calls[0]!.params, [NOW]);
  });

  it("stampSync appends one immutable audit row (proposal id, reject_drafts_executed, rejected, at)", async () => {
    const { db, calls } = fakeDb([{ rows: [], rowCount: 1 }]);
    await makeRejectDraftsStore(db).stampSync("canary-reject-drafts", NOW, 2);
    assert.match(calls[0]!.text, /insert into public\.cockpit_proposal_audit/i);
    assert.match(calls[0]!.text, /\(proposal_id, event, to_status, at\)/i);
    assert.deepEqual(calls[0]!.params, ["canary-reject-drafts", "reject_drafts_executed", "rejected", NOW]);
  });

  it("a re-run that rejects nothing reports 0 (idempotent)", async () => {
    const { db } = fakeDb([{ rows: [], rowCount: 0 }]);
    assert.equal(await makeRejectDraftsStore(db).rejectDraftProposals(NOW), 0);
  });
});

describe("runRejectDrafts — fail-closed gate (plan §14)", () => {
  it("flag OFF (default, env {}) → refused, NOT executed; attempt + refusal audited; store untouched", async () => {
    const store = makeStore();
    const { result, logs } = await captureLogs(() =>
      runRejectDrafts(APPROVED, {}, { now: NOW, store, hasCapabilityToken: true }),
    );
    assert.equal(result.executed, false);
    assert.equal(store.rejected, 0, "must not touch data when refused");
    assert.equal(store.stamped, 0);
    assert.ok(logs.some((l) => l.includes("execution_attempt")), "the attempt must be audited");
    assert.ok(logs.some((l) => l.includes("execution_refused")), "the refusal must be audited");
  });

  it("global kill-switch overrides a 'true' flag → refused, store untouched", async () => {
    const store = makeStore();
    const { result } = await captureLogs(() =>
      runRejectDrafts(
        APPROVED,
        { [REJECT_DRAFTS_FLAG]: "true", [KILL_SWITCH_ENV]: "on" },
        { now: NOW, store, hasCapabilityToken: true },
      ),
    );
    assert.equal(result.executed, false);
    assert.equal(store.rejected, 0);
  });

  it("happy path: flag ON + all preconditions → executes once, reports before/after, reversible, audited", async () => {
    const store = makeStore(3);
    const { result, logs } = await captureLogs(() =>
      runRejectDrafts(
        APPROVED,
        { [REJECT_DRAFTS_FLAG]: "true" },
        { now: NOW, store, hasCapabilityToken: true },
      ),
    );
    assert.equal(result.executed, true);
    assert.equal(result.outcome?.reversible, true);
    assert.deepEqual(result.outcome?.before, { draftProposals: 3 });
    assert.deepEqual(result.outcome?.after, { draftProposals: 0 });
    assert.equal(store.rejected, 3);
    assert.equal(store.stamped, 1);
    assert.ok(logs.some((l) => l.includes("executed")), "the result must be audited");
  });

  it("idempotent: a re-run on an empty draft set rejects 0 (no-op, still reversible)", async () => {
    const store = makeStore(0);
    const { result } = await captureLogs(() =>
      runRejectDrafts(
        APPROVED,
        { [REJECT_DRAFTS_FLAG]: "true" },
        { now: NOW, store, hasCapabilityToken: true },
      ),
    );
    assert.equal(result.executed, true);
    assert.deepEqual(result.outcome?.after, { draftProposals: 0 });
    assert.equal(store.rejected, 0);
  });

  it("dryRun never writes (counts only)", async () => {
    const store = makeStore(2);
    const { result } = await captureLogs(() =>
      runRejectDrafts(
        APPROVED,
        { [REJECT_DRAFTS_FLAG]: "true" },
        { now: NOW, dryRun: true, store, hasCapabilityToken: true },
      ),
    );
    assert.equal(result.executed, false);
    assert.equal(result.outcome?.ran, false);
    assert.deepEqual(result.outcome?.before, { draftProposals: 2 });
    assert.equal(store.rejected, 0);
    assert.equal(store.stamped, 0);
  });

  it("SQL/params pinned end-to-end: a real execute issues UPDATE…draft RETURNING id then the audit INSERT", async () => {
    // Drive runRejectDrafts through the DB-backed store with a fake Queryable so the exact
    // SQL the executor would send is pinned: the conditional reject, then the audit insert.
    const { db, calls } = fakeDb([
      { rows: [{ n: 2 }], rowCount: 1 }, // before count
      { rows: [{ id: "d1" }, { id: "d2" }], rowCount: 2 }, // reject (UPDATE … RETURNING id)
      { rows: [], rowCount: 1 }, // audit insert
      { rows: [{ n: 0 }], rowCount: 1 }, // after count
    ]);
    const store = makeRejectDraftsStore(db);
    const { result } = await captureLogs(() =>
      runRejectDrafts(
        APPROVED,
        { [REJECT_DRAFTS_FLAG]: "true" },
        { now: NOW, store, hasCapabilityToken: true },
      ),
    );
    assert.equal(result.executed, true);
    assert.deepEqual(result.outcome?.before, { draftProposals: 2 });
    assert.deepEqual(result.outcome?.after, { draftProposals: 0 });
    // The conditional UPDATE targets ONLY draft rows and returns ids.
    const update = calls.find((c) => /update public\.cockpit_proposals/i.test(c.text));
    assert.ok(update, "an UPDATE must have been issued");
    assert.match(update!.text, /set status='rejected'/i);
    assert.match(update!.text, /where status='draft'/i);
    assert.match(update!.text, /returning id/i);
    // The durable audit row records the draft→rejected transition.
    const audit = calls.find((c) => /insert into public\.cockpit_proposal_audit/i.test(c.text));
    assert.ok(audit, "an audit INSERT must have been issued");
    assert.deepEqual(audit!.params, ["p-auth", "reject_drafts_executed", "rejected", NOW]);
  });
});
