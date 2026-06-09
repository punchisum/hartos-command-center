/**
 * tests/state-delta.test.ts
 *
 * 3-levels-up master plan §13 — `toStateDeltaSignal` is a PURE projection of the audit-after
 * row the adapters already produce (`ExecutionOutcome.before`/`after`). These tests are fully
 * hermetic: no env, no network, no fs, no Supabase, and `now` is injected (never the ambient
 * clock) so the projection is deterministic.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toStateDeltaSignal, type StateDeltaSignal } from "../src/execution/state-delta.js";
import type { AdapterRunResult, ExecutionOutcome } from "../src/execution/execution-adapter.js";
import type { PreconditionResult } from "../src/doctrine/execution-gate.js";

const NOW = new Date("2026-06-09T12:00:00.000Z");

/** A passing precondition — the projector never inspects it; it only reads outcome.ran. */
const PRE_OK: PreconditionResult = { allowed: true, denials: [] };

function outcome(over: Partial<ExecutionOutcome> = {}): ExecutionOutcome {
  return {
    ran: true,
    reversible: true,
    before: { status: "Waiting on Hart" },
    after: { status: "In Progress" },
    summary: "moved card",
    ...over,
  };
}

function runResult(over: Partial<AdapterRunResult> = {}): AdapterRunResult {
  return {
    adapterId: "clickup-move-status",
    precondition: PRE_OK,
    executed: true,
    outcome: outcome(),
    ...over,
  };
}

function ctx(over: Partial<Parameters<typeof toStateDeltaSignal>[1]> = {}) {
  return {
    domain: "ops" as const,
    actionType: "ops_followup_plan" as const,
    proposalId: "prop_123",
    changedEntity: "Virtual Card API Clarification",
    now: NOW,
    ...over,
  };
}

describe("toStateDeltaSignal — projection of the audit-after row", () => {
  it("projects every §13 field from a fake AdapterRunResult", () => {
    const delta = toStateDeltaSignal(runResult(), ctx());
    assert.notEqual(delta, null);
    const d = delta as StateDeltaSignal;
    assert.equal(d.source, "clickup-move-status"); // defaults to adapterId
    assert.equal(d.domain, "ops");
    assert.equal(d.changedEntity, "Virtual Card API Clarification");
    assert.equal(d.actionType, "ops_followup_plan");
    assert.equal(d.auditId, "prop_123"); // proposalId is the audit row's stable key
    assert.equal(d.freshness, "live");
    assert.deepEqual(d.affectedAgents, ["Ops Agent", "Fleet Brain"]);
  });

  it("passes before/after through verbatim (same reference, no copy)", () => {
    const out = outcome({ before: { a: 1, nested: { x: true } }, after: { a: 2, nested: { x: false } } });
    const result = runResult({ outcome: out });
    const d = toStateDeltaSignal(result, ctx()) as StateDeltaSignal;
    assert.equal(d.before, out.before);
    assert.equal(d.after, out.after);
    assert.deepEqual(d.before, { a: 1, nested: { x: true } });
    assert.deepEqual(d.after, { a: 2, nested: { x: false } });
  });

  it("uses an explicit source when provided", () => {
    const d = toStateDeltaSignal(runResult(), ctx({ source: "executor-host" })) as StateDeltaSignal;
    assert.equal(d.source, "executor-host");
  });

  it("freshness is 'live' for an injected now (now == asOf)", () => {
    const d = toStateDeltaSignal(runResult(), ctx({ now: new Date("2030-01-01T00:00:00.000Z") })) as StateDeltaSignal;
    assert.equal(d.freshness, "live");
  });
});

describe("toStateDeltaSignal — null on no execution (noop / refusal)", () => {
  it("returns null when outcome is null (a refusal)", () => {
    const d = toStateDeltaSignal(runResult({ outcome: null, executed: false }), ctx());
    assert.equal(d, null);
  });

  it("returns null when outcome.ran === false (a noop)", () => {
    const d = toStateDeltaSignal(runResult({ outcome: outcome({ ran: false }), executed: false }), ctx());
    assert.equal(d, null);
  });
});

describe("toStateDeltaSignal — affectedAgents fan-out is order-pinned per domain", () => {
  it("ops → ['Ops Agent', 'Fleet Brain']", () => {
    const d = toStateDeltaSignal(runResult(), ctx({ domain: "ops" })) as StateDeltaSignal;
    assert.deepEqual(d.affectedAgents, ["Ops Agent", "Fleet Brain"]);
  });

  it("fitness → ['Fitness Agent', 'Fleet Brain']", () => {
    const d = toStateDeltaSignal(runResult(), ctx({ domain: "fitness", actionType: "fitness_adjustment_plan" })) as StateDeltaSignal;
    assert.deepEqual(d.affectedAgents, ["Fitness Agent", "Fleet Brain"]);
  });

  it("factory → ['Factory Agent', 'Fleet Brain'] (no contract, static label)", () => {
    const d = toStateDeltaSignal(runResult(), ctx({ domain: "factory", actionType: "build_agent_plan" })) as StateDeltaSignal;
    assert.deepEqual(d.affectedAgents, ["Factory Agent", "Fleet Brain"]);
  });

  it("system → ['System', 'Fleet Brain']", () => {
    const d = toStateDeltaSignal(runResult(), ctx({ domain: "system", actionType: "review_plan" })) as StateDeltaSignal;
    assert.deepEqual(d.affectedAgents, ["System", "Fleet Brain"]);
  });

  it("research → ['Research Agent', 'Fleet Brain']", () => {
    const d = toStateDeltaSignal(runResult(), ctx({ domain: "research", actionType: "research_plan" })) as StateDeltaSignal;
    assert.deepEqual(d.affectedAgents, ["Research Agent", "Fleet Brain"]);
  });
});
