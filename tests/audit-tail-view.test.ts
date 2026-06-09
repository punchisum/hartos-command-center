/**
 * tests/audit-tail-view.test.ts
 *
 * The PURE, Worker-safe hosted-cockpit Audit Trail view-builder (`auditTailView`), which
 * projects an already-fetched `AuditRow[]` (the immutable cockpit_proposal_audit tail) into a
 * read-only panel and adds the honest available/unavailable branching the hosted views use
 * (mirroring `mutationCenterView`).
 *
 * Hermetic: no env, no network, no fs, no pg/Supabase, no ambient clock. Rows are hand-built
 * fixtures; the view itself reads no clock. Proves: null/undefined rows ⇒ available:false +
 * honest "no provider" note + zero rows; present rows ⇒ available:true, projected, newest-
 * first preserved, fields present, no fabrication; empty array ⇒ available:true + zero rows +
 * a DISTINCT honest empty-state note; executable "disabled"; serialized view has no
 * execute/secret token; determinism.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditTailView } from "../src/runtime/views/audit-tail-view.js";
import type { AuditRow } from "../src/execution/audit-tail.js";

const T2 = "2026-06-09T12:00:02.000Z";
const T1 = "2026-06-09T12:00:01.000Z";
const T0 = "2026-06-09T12:00:00.000Z";

/** Build an AuditRow fixture. Overrides win. */
function row(over: Partial<AuditRow> = {}): AuditRow {
  const base: AuditRow = {
    proposalId: "p1",
    event: "approved_for_execution",
    toStatus: "approved_for_execution",
    at: T1,
  };
  return { ...base, ...over };
}

/** A newest-first tail (as `fetchAuditTail` returns it: order by at desc). */
function tail(): AuditRow[] {
  return [
    row({ proposalId: "p3", event: "executed", toStatus: "executed", at: T2 }),
    row({ proposalId: "p2", event: "approved_for_execution", toStatus: "approved_for_execution", at: T1 }),
    row({ proposalId: "p1", event: "proposed", toStatus: null, at: T0 }),
  ];
}

describe("auditTailView — present rows", () => {
  it("available:true, rows projected, newest-first preserved, fields present", () => {
    const view = auditTailView(tail());
    assert.equal(view.available, true);
    if (!view.available) return; // narrow for TS
    assert.equal(view.executable, "disabled");
    assert.equal(view.mode, "read_only_snapshot");
    assert.equal(view.total, 3);
    assert.equal(view.rows.length, 3);

    // newest-first order preserved (the supplied order is not re-sorted).
    assert.deepEqual(
      view.rows.map((r) => r.proposalId),
      ["p3", "p2", "p1"],
    );
    assert.deepEqual(
      view.rows.map((r) => r.at),
      [T2, T1, T0],
    );

    const newest = view.rows[0]!;
    assert.equal(newest.event, "executed");
    assert.equal(newest.toStatus, "executed");
    assert.equal(newest.proposalId, "p3");
    assert.equal(newest.detail, "executed → executed (p3)");

    // a null toStatus is preserved (not fabricated) and rendered honestly in the detail.
    const oldest = view.rows[2]!;
    assert.equal(oldest.toStatus, null);
    assert.equal(oldest.detail, "proposed (p1)");

    // rendered block is the PURE formatAuditTail output and mentions every proposal id.
    assert.equal(typeof view.rendered, "string");
    assert.match(view.rendered, /p3/);
    assert.match(view.rendered, /p2/);
    assert.match(view.rendered, /p1/);

    // honest "present" note — not the unavailable / empty note.
    assert.match(view.note, /newest first/i);
    assert.doesNotMatch(view.note, /unavailable/i);
  });

  it("normalizes a Date `at` to a stable ISO string", () => {
    const view = auditTailView([row({ at: new Date(T1) })]);
    assert.equal(view.available, true);
    if (!view.available) return;
    assert.equal(view.rows[0]!.at, T1);
  });

  it("respects a positive limit (newest-first) and ignores a non-positive one", () => {
    const capped = auditTailView(tail(), { limit: 2 });
    assert.equal(capped.available, true);
    if (!capped.available) return;
    assert.equal(capped.total, 2);
    assert.deepEqual(capped.rows.map((r) => r.proposalId), ["p3", "p2"]);

    const uncapped = auditTailView(tail(), { limit: 0 });
    assert.equal(uncapped.available, true);
    if (!uncapped.available) return;
    assert.equal(uncapped.total, 3);
  });

  it("is deterministic for the same rows", () => {
    const rows = tail();
    assert.deepEqual(auditTailView(rows), auditTailView(rows));
  });
});

describe("auditTailView — absent rows (honest unavailable branch)", () => {
  it("undefined rows ⇒ available:false + honest no-provider note + zero rows", () => {
    const view = auditTailView(undefined);
    assert.equal(view.available, false);
    if (view.available) return;
    assert.equal(view.executable, "disabled");
    assert.equal(view.mode, "read_only_snapshot");
    assert.equal(view.total, 0);
    assert.deepEqual(view.rows, []);
    assert.equal(view.rendered, "");
    assert.match(view.note, /unavailable/i);
    assert.match(view.note, /no audit provider configured/i);
  });

  it("null rows ⇒ available:false (same honest shell)", () => {
    const view = auditTailView(null);
    assert.equal(view.available, false);
    if (view.available) return;
    assert.deepEqual(view.rows, []);
    assert.match(view.note, /unavailable/i);
  });
});

describe("auditTailView — empty array (honest empty-state, distinct from unavailable)", () => {
  it("empty array ⇒ available:true with zero rows and a DISTINCT empty-state note", () => {
    const view = auditTailView([]);
    assert.equal(view.available, true);
    if (!view.available) return;
    assert.equal(view.total, 0);
    assert.deepEqual(view.rows, []);
    // empty ≠ unavailable: the empty-state note must say so honestly.
    assert.match(view.note, /empty audit trail, not an unavailable one/i);
    assert.doesNotMatch(view.note, /no audit provider configured/i);
    // formatAuditTail's own empty sentinel surfaces in the rendered block.
    assert.match(view.rendered, /no audit rows/i);
  });
});

describe("auditTailView — read-only invariants", () => {
  it("the serialized view carries NO execute/fetch/POST/secret token (not an execution surface)", () => {
    const blob = JSON.stringify(auditTailView(tail()));
    assert.equal(/(?<!non-)execute(?!d)/i.test(blob), false);
    assert.equal(/fetch/i.test(blob), false);
    assert.equal(/POST/i.test(blob), false);
    // no secret-shaped value leaked through the projection.
    assert.equal(/secret|token|password|api[_-]?key|bearer/i.test(blob), false);
  });

  it("does not fabricate rows in any branch and keeps executable 'disabled'", () => {
    const present = auditTailView(tail());
    assert.equal(present.executable, "disabled");
    const absent = auditTailView(undefined);
    assert.equal(absent.executable, "disabled");
    assert.deepEqual(absent.rows, []);
    const empty = auditTailView([]);
    assert.equal(empty.executable, "disabled");
    assert.deepEqual(empty.rows, []);
  });
});
