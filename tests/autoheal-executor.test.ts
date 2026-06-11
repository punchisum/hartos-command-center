/**
 * tests/autoheal-executor.test.ts — the guardrailed-autonomy executor core.
 *
 * runAutohealCore: only eligible (armed-adapter) rows are touched; each is transitioned to
 * approved_for_execution (audited), dispatched; a real write advances → executed (audited); a
 * no-write REVERTS the row to simulated_approved (audited) so nothing is left stuck. Non-class
 * rows (e.g. ClickUp) are never touched. Disarmed env = a pure no-op.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAutohealCore, type AutohealDb } from "../src/execution/autoheal-executor.js";
import { ADAPTER_ROUTE_KEY, type DispatchFn } from "../src/execution/approved-executor.js";
import { AUTOHEAL_PROPOSAL_HYGIENE_FLAG } from "../src/doctrine/autoheal-gate.js";
import type { DispatchResult } from "../src/execution/execution-dispatch.js";

interface FakeRow { status: string; payload: Record<string, unknown>; }

function row(adapterId: string, createdAt: string): Record<string, unknown> {
  return { createdAt, proposedPayload: { [ADAPTER_ROUTE_KEY]: { adapterId, tier: "T0" } } };
}

/** An in-memory cockpit_proposals + audit table that honours the CAS UPDATEs the executor issues. */
function makeFakeDb(seed: Record<string, FakeRow>) {
  const rows = new Map(Object.entries(seed));
  const audits: Array<{ id: string; event: string }> = [];
  const db: AutohealDb = {
    async query(text, params = []) {
      const p = params as unknown[];
      if (/^select id, payload from public\.cockpit_proposals where status=/i.test(text)) {
        const status = p[0];
        const out = [...rows.entries()]
          .filter(([, v]) => v.status === status)
          .map(([id, v]) => ({ id, payload: v.payload }));
        return { rows: out, rowCount: out.length };
      }
      if (/^update public\.cockpit_proposals set status=/i.test(text)) {
        // advance form: set status='executed' ... where id=$1 and status=$2 → [id, expected]
        // transition/revert: set status=$2 ... where id=$1 and status=$3 → [id, newStatus, expected]
        const isAdvance = /set status='executed'/.test(text);
        const id = String(p[0]);
        const newStatus = isAdvance ? "executed" : String(p[1]);
        const expected = isAdvance ? String(p[1]) : String(p[2]);
        const r = rows.get(id);
        if (r && r.status === expected) {
          r.status = newStatus;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (/^insert into public\.cockpit_proposal_audit/i.test(text)) {
        const m = /values\s*\(\$1,\s*'([a-z_]+)'/i.exec(text);
        audits.push({ id: String(p[0]), event: m ? m[1] : "?" });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { db, rows, audits };
}

function fakeDispatch(wroteFor: (id: string) => boolean): DispatchFn {
  return async (command): Promise<DispatchResult> => {
    const wrote = wroteFor(command.proposal.id);
    return {
      adapterId: command.adapterId,
      result: {
        adapterId: command.adapterId,
        precondition: { allowed: true, denials: [] },
        executed: wrote,
        outcome: { ran: wrote, reversible: true, before: {}, after: {}, summary: wrote ? "wrote (fake)" : "no write (gate refused)" },
      },
      delta: wrote ? ({ source: command.adapterId } as unknown as DispatchResult["delta"]) : null,
    };
  };
}

const ARMED = {
  [AUTOHEAL_PROPOSAL_HYGIENE_FLAG]: "true",
  ALLOW_EXEC_REJECT_DRAFTS: "true",
  ALLOW_EXEC_ARCHIVE_REJECTED: "true",
  ALLOW_EXEC_REFRESH_SYNC: "true",
} as const;

const now = new Date("2026-06-11T08:00:00Z");
const stores = { rejectDrafts: {}, archiveRejected: {}, refreshSync: {} } as never;

describe("autoheal executor core", () => {
  it("disarmed env is a pure no-op (no query touches a row)", async () => {
    const { db, rows } = makeFakeDb({ p1: { status: "simulated_approved", payload: row("reject-drafts", "2026-06-10T10:00:00Z") } });
    const summary = await runAutohealCore({ db, stores, env: {}, dispatch: fakeDispatch(() => true), now });
    assert.equal(summary.executed, 0);
    assert.equal(summary.authorized, 0);
    assert.equal(rows.get("p1")?.status, "simulated_approved");
    assert.match(summary.lines[0], /no autoheal class fully armed/);
  });

  it("a write advances the row → executed; a no-write reverts it; non-class rows are untouched", async () => {
    const { db, rows, audits } = makeFakeDb({
      p_reject: { status: "simulated_approved", payload: row("reject-drafts", "2026-06-10T10:00:00Z") },
      p_refresh: { status: "simulated_approved", payload: row("refresh-sync", "2026-06-10T09:00:00Z") },
      p_clickup: { status: "simulated_approved", payload: row("clickup-move-status", "2026-06-10T08:00:00Z") },
    });
    // reject-drafts writes; refresh-sync refuses (no write).
    const summary = await runAutohealCore({
      db, stores, env: ARMED, now,
      dispatch: fakeDispatch((id) => id === "p_reject"),
    });

    assert.equal(summary.eligible, 2, "only the two internal-class rows are eligible");
    assert.equal(summary.authorized, 2);
    assert.equal(summary.executed, 1);
    assert.equal(summary.reverted, 1);

    assert.equal(rows.get("p_reject")?.status, "executed");
    assert.equal(rows.get("p_refresh")?.status, "simulated_approved", "no-write reverted, not stuck");
    assert.equal(rows.get("p_clickup")?.status, "simulated_approved", "external adapter never touched");

    const ev = (id: string) => audits.filter((a) => a.id === id).map((a) => a.event);
    assert.deepEqual(ev("p_reject"), ["autoheal_authorized", "executed"]);
    assert.deepEqual(ev("p_refresh"), ["autoheal_authorized", "autoheal_reverted"]);
    assert.deepEqual(ev("p_clickup"), [], "the ClickUp row gets no audit — it was never authorized");
  });

  it("honours the max-writes cap and reverts the authorized-but-unattempted overflow", async () => {
    const { db, rows } = makeFakeDb({
      a: { status: "simulated_approved", payload: row("reject-drafts", "2026-06-10T12:00:00Z") },
      b: { status: "simulated_approved", payload: row("archive-rejected", "2026-06-10T11:00:00Z") },
      c: { status: "simulated_approved", payload: row("refresh-sync", "2026-06-10T10:00:00Z") },
    });
    const summary = await runAutohealCore({ db, stores, env: ARMED, now, max: 1, dispatch: fakeDispatch(() => true) });
    assert.equal(summary.authorized, 3);
    assert.equal(summary.executed, 1, "the cap stops after one write");
    // Exactly one executed; the rest must be reverted to simulated_approved, never stuck at approved_for_execution.
    const statuses = ["a", "b", "c"].map((id) => rows.get(id)?.status);
    assert.equal(statuses.filter((s) => s === "executed").length, 1);
    assert.equal(statuses.filter((s) => s === "simulated_approved").length, 2);
    assert.equal(statuses.filter((s) => s === "approved_for_execution").length, 0, "nothing left stuck");
  });
});
