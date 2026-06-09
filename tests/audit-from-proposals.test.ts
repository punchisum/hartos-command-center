/**
 * tests/audit-from-proposals.test.ts
 *
 * FU-2 — the PURE, Worker-safe mapper `auditRowsFromProposals(state)` that gives the hosted
 * Audit Trail panel a real LOCAL data source by flattening every proposal's own append-only
 * `auditEvents` (in the Worker-resolved CockpitState) into the `AuditRow[]` the view consumes —
 * with zero new infrastructure (no pg, no fs, no crypto).
 *
 * Hermetic: no env, no network, no fs, no pg/Supabase, no ambient clock. The CockpitState +
 * proposal queue are hand-built fixtures with literal timestamps; the mapper reads no clock.
 * Proves: flattens audit events across multiple proposals; newest-first by `at`; null when
 * state/queue absent (so the view shows honest-unavailable); empty queue ⇒ empty array (DISTINCT
 * from null, so the view shows honest empty-state); null toStatus preserved (no fabrication);
 * determinism.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditRowsFromProposals } from "../src/runtime/views/audit-from-proposals.js";
import type { CockpitState } from "../src/cockpit/cockpit-types.js";
import type {
  DryRunResult,
  ProposalAuditEvent,
  ProposalQueueItem,
} from "../src/cockpit/proposals/proposal-types.js";

const T2 = "2026-06-09T12:00:02.000Z";
const T1 = "2026-06-09T12:00:01.000Z";
const T0 = "2026-06-09T12:00:00.000Z";

function dryRun(): DryRunResult {
  return {
    wouldHappen: "Would approve proposal for execution (no real effect).",
    dataWouldTouch: ["cockpit-proposals/p.json"],
    approvalRequired: "Hart",
    executionDisabledReason: "execution is disabled in this plane",
    futureSetupRequired: ["arm the adapter allowlist flag"],
    executed: false,
  };
}

/** Build a ProposalQueueItem fixture — a COMPLETE T1 payload by default. Overrides win. */
function item(over: Partial<ProposalQueueItem> = {}): ProposalQueueItem {
  const base: ProposalQueueItem = {
    id: "p1",
    domain: "system",
    actionType: "review_plan",
    title: "Approve refresh-sync for execution",
    description: "Approve the proposal for execution (Key 1).",
    sourceIntent: "approve for execution",
    proposedPayload: {},
    expectedEffect: "proposal becomes approved_for_execution",
    riskLevel: "low",
    requiredApproval: "Hart",
    createdAt: T0,
    expiresAt: null,
    safetyNotes: [],
    blockedReason: "execution is gated off-Worker",
    dryRunResult: dryRun(),
    executable: false,
    tier: "T1",
    targetId: "target-p1",
    targetName: "Refresh-sync proposal",
    idempotencyKey: "idem-p1",
    rollbackOrCorrectionNote: "revoke execution approval to undo",
    status: "approved_for_execution",
    updatedAt: T0,
    auditEvents: [{ at: T0, event: "proposed" }],
  };
  return { ...base, ...over };
}

/** Hand-built CockpitState carrying just the proposal queue the mapper reads. */
function stateWith(proposalQueue: ProposalQueueItem[] | undefined): CockpitState | undefined {
  if (proposalQueue === undefined) return undefined;
  return { generatedAt: T0, proposalQueue } as unknown as CockpitState;
}

describe("auditRowsFromProposals — flatten + order", () => {
  it("flattens audit events across multiple proposals into one tail", () => {
    const ev1: ProposalAuditEvent[] = [
      { at: T0, event: "proposed" },
      { at: T1, event: "pending_approval" },
    ];
    const ev2: ProposalAuditEvent[] = [{ at: T2, event: "approved_for_execution" }];
    const rows = auditRowsFromProposals(
      stateWith([
        item({ id: "p1", auditEvents: ev1 }),
        item({ id: "p2", auditEvents: ev2 }),
      ]),
    );
    assert.notEqual(rows, null);
    if (rows == null) return; // narrow for TS
    assert.equal(rows.length, 3);
    // every proposalId is stamped from its owning item.
    const ids = new Set(rows.map((r) => r.proposalId));
    assert.deepEqual([...ids].sort(), ["p1", "p2"]);
    // the event names are carried verbatim.
    const events = new Set(rows.map((r) => r.event));
    assert.ok(events.has("proposed"));
    assert.ok(events.has("pending_approval"));
    assert.ok(events.has("approved_for_execution"));
  });

  it("sorts newest-first by `at` across proposals", () => {
    const rows = auditRowsFromProposals(
      stateWith([
        item({ id: "p1", auditEvents: [{ at: T0, event: "proposed" }] }),
        item({ id: "p2", auditEvents: [{ at: T2, event: "approved_for_execution" }] }),
        item({ id: "p3", auditEvents: [{ at: T1, event: "pending_approval" }] }),
      ]),
    );
    assert.notEqual(rows, null);
    if (rows == null) return;
    assert.deepEqual(
      rows.map((r) => r.at),
      [T2, T1, T0],
    );
    assert.deepEqual(
      rows.map((r) => r.proposalId),
      ["p2", "p3", "p1"],
    );
  });

  it("derives toStatus only when the event name IS a known status (no fabrication)", () => {
    const rows = auditRowsFromProposals(
      stateWith([
        item({
          id: "p1",
          auditEvents: [
            { at: T0, event: "proposed" }, // not a known status ⇒ null
            { at: T1, event: "executed" }, // a known status ⇒ derived honestly
          ],
        }),
      ]),
    );
    assert.notEqual(rows, null);
    if (rows == null) return;
    const byEvent = new Map(rows.map((r) => [r.event, r]));
    assert.equal(byEvent.get("proposed")!.toStatus, null);
    assert.equal(byEvent.get("executed")!.toStatus, "executed");
  });

  it("preserves a null toStatus even when a free-form detail is present (never invents one)", () => {
    const rows = auditRowsFromProposals(
      stateWith([
        item({
          id: "p1",
          auditEvents: [{ at: T0, event: "edited", detail: "moved to approved_for_execution" }],
        }),
      ]),
    );
    assert.notEqual(rows, null);
    if (rows == null) return;
    assert.equal(rows.length, 1);
    // detail mentions a status name, but the EVENT is "edited" — we must not launder a status.
    assert.equal(rows[0]!.toStatus, null);
    assert.equal(rows[0]!.event, "edited");
  });
});

describe("auditRowsFromProposals — honest absent / empty branches", () => {
  it("returns null when state is undefined (⇒ view shows honest-unavailable)", () => {
    assert.equal(auditRowsFromProposals(undefined), null);
  });

  it("returns null when state is null", () => {
    assert.equal(auditRowsFromProposals(null), null);
  });

  it("returns null when proposalQueue is absent", () => {
    assert.equal(auditRowsFromProposals(stateWith(undefined)), null);
    // a state object with no proposalQueue field at all is also null (not [] ).
    assert.equal(
      auditRowsFromProposals({ generatedAt: T0 } as unknown as CockpitState),
      null,
    );
  });

  it("empty queue ⇒ empty array (DISTINCT from null, so the view shows empty-state)", () => {
    const rows = auditRowsFromProposals(stateWith([]));
    assert.notEqual(rows, null);
    assert.deepEqual(rows, []);
  });

  it("queue of proposals that carry no audit events ⇒ empty array (not null)", () => {
    const rows = auditRowsFromProposals(
      stateWith([item({ id: "p1", auditEvents: [] }), item({ id: "p2", auditEvents: [] })]),
    );
    assert.notEqual(rows, null);
    assert.deepEqual(rows, []);
  });
});

describe("auditRowsFromProposals — determinism + safety", () => {
  it("is deterministic for the same state", () => {
    const state = stateWith([
      item({ id: "p1", auditEvents: [{ at: T0, event: "proposed" }] }),
      item({ id: "p2", auditEvents: [{ at: T2, event: "executed" }] }),
    ]);
    assert.deepEqual(auditRowsFromProposals(state), auditRowsFromProposals(state));
  });

  it("carries event NAMES only — no proposal payload / secret leaks into the rows", () => {
    const rows = auditRowsFromProposals(
      stateWith([
        item({
          id: "p1",
          proposedPayload: { apiKey: "super-secret-token" },
          auditEvents: [{ at: T0, event: "proposed" }],
        }),
      ]),
    );
    const blob = JSON.stringify(rows);
    assert.equal(/super-secret-token/.test(blob), false);
    assert.equal(/secret|token|password|api[_-]?key|bearer/i.test(blob), false);
  });
});
