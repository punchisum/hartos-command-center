/**
 * tests/fleet-delta-consumer.test.ts — 3-levels-up master plan §13 (the "refresh→learn" glue).
 *
 * `delta-consumer.ts` is the PURE glue between the execution dispatcher's `DispatchResult.delta`
 * and the Fleet Brain's incremental `applyDeltas`. These tests are fully hermetic — no env, no
 * network, no fs, and every `now` is injected (never the ambient clock). They pin:
 *   - `collectDeltas` drops null deltas (noops / refusals / dry-runs contribute nothing).
 *   - one executed delta updates EXACTLY the matching briefing item via the Brain's path; others
 *     are byte-identical (same reference).
 *   - an all-null batch returns the prior briefing UNCHANGED (same reference).
 *   - §19 is preserved (asserted through the Brain's behavior, not a reimplementation): a
 *     stale/dead delta degrades confidence and never upgrades it.
 *   - determinism: same inputs twice → deep-equal.
 *
 * Fixtures reuse the shapes from tests/fleet-brain.test.ts (signal/fleetSignal/delta) and
 * tests/state-delta.test.ts (outcome/runResult), so this stays in lockstep with both halves.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectDeltas, applyDispatchDeltas } from "../src/fleet/delta-consumer.js";
import { assembleBriefing, type FleetBriefing } from "../src/fleet/fleet-brain.js";
import type { FleetSignal, AgentSignal } from "../src/read-models/agent-signal.js";
import type { StateDeltaSignal } from "../src/execution/state-delta.js";
import type { DispatchResult } from "../src/execution/execution-dispatch.js";
import type { AdapterRunResult, ExecutionOutcome } from "../src/execution/execution-adapter.js";
import type { PreconditionResult } from "../src/doctrine/execution-gate.js";

const NOW = new Date("2026-06-09T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const LATER = new Date("2026-06-09T13:00:00.000Z");

// ─── Fixtures (all explicit — no hidden defaults that read the clock) ────────────

const PRE_OK: PreconditionResult = { allowed: true, denials: [] };

function signal(over: Partial<AgentSignal> = {}): AgentSignal {
  return {
    verdict: "clear",
    confidence: "high",
    facts: [],
    freshness: "live",
    reason: "all clear",
    nextAction: null,
    approvalNeeded: false,
    ...over,
  };
}

function fleetSignal(id: string, type: FleetSignal["type"], over: Partial<AgentSignal> = {}): FleetSignal {
  return { id, type, signal: signal(over) };
}

function delta(over: Partial<StateDeltaSignal> = {}): StateDeltaSignal {
  return {
    source: "refresh-sync",
    domain: "ops",
    changedEntity: "card XYZ",
    before: {},
    after: {},
    actionType: "ops_followup_plan",
    auditId: "audit-1",
    affectedAgents: ["Ops Agent", "Fleet Brain"],
    freshness: "live",
    ...over,
  };
}

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

/** A DispatchResult that EXECUTED — carries a non-null delta the consumer should apply. */
function executed(d: StateDeltaSignal, adapterId: DispatchResult["adapterId"] = "clickup-move-status"): DispatchResult {
  return { adapterId, result: runResult({ adapterId }), delta: d, verification: null };
}

/** A DispatchResult that did NOT execute (noop / refusal / dry-run) — null delta, contributes nothing. */
function noExec(adapterId: DispatchResult["adapterId"] = "clickup-move-status"): DispatchResult {
  return { adapterId, result: runResult({ adapterId, executed: false, outcome: null }), delta: null, verification: null };
}

/** A two-signal prior briefing (ops + fitness), both live/high — the canonical incremental fixture. */
function priorBriefing(): FleetBriefing {
  return assembleBriefing({
    signals: [
      fleetSignal("ops", "ops", { verdict: "urgent", confidence: "high", freshness: "live" }),
      fleetSignal("fitness", "fitness", { verdict: "green", confidence: "high", freshness: "live" }),
    ],
    now: NOW,
  });
}

// ─── collectDeltas drops nulls, preserves order ──────────────────────────────────

describe("delta-consumer — collectDeltas", () => {
  it("extracts only the non-null deltas, in input order", () => {
    const dA = delta({ auditId: "a" });
    const dB = delta({ auditId: "b" });
    const out = collectDeltas([executed(dA), noExec(), executed(dB), noExec()]);
    assert.deepEqual(out, [dA, dB]);
    assert.equal(out[0], dA, "same reference, no copy");
    assert.equal(out[1], dB, "same reference, no copy");
  });

  it("an empty batch → no deltas", () => {
    assert.deepEqual(collectDeltas([]), []);
  });

  it("an all-null batch (noops / refusals / dry-runs) → no deltas", () => {
    assert.deepEqual(collectDeltas([noExec(), noExec()]), []);
  });
});

// ─── one executed delta updates EXACTLY the matching item via the Brain's path ───

describe("delta-consumer — applyDispatchDeltas", () => {
  it("an executed delta updates the matching item; others are byte-identical (same reference)", () => {
    const prior = priorBriefing();
    const opsBefore = prior.items.find((i) => i.domain === "ops")!;
    const fitnessBefore = prior.items.find((i) => i.domain === "fitness")!;

    const next = applyDispatchDeltas(
      prior,
      [executed(delta({ domain: "ops", freshness: "stale", auditId: "audit-ops-stale" }))],
      LATER,
    );

    const opsAfter = next.items.find((i) => i.domain === "ops")!;
    const fitnessAfter = next.items.find((i) => i.domain === "fitness")!;

    // The fitness item is untouched → SAME object reference (the Brain did not re-synthesize it).
    assert.equal(fitnessAfter, fitnessBefore, "an untouched item is returned by reference");

    // The ops item changed exactly as the Brain's applyDeltas would: freshness worsened to the
    // delta's band, and the touching auditId was recorded.
    assert.notEqual(opsAfter, opsBefore, "the matched item is a new object");
    assert.equal(opsAfter.freshness, "stale");
    assert.ok(opsAfter.auditIds.includes("audit-ops-stale"));

    // The injected `now` is the honest generatedAt (deltas were applied, so the stamp updates).
    assert.equal(next.generatedAt, LATER.toISOString());
  });

  it("ignores the null deltas in a mixed batch — only the executed one is applied", () => {
    const prior = priorBriefing();
    const next = applyDispatchDeltas(
      prior,
      [noExec(), executed(delta({ domain: "ops", freshness: "stale", auditId: "mixed" })), noExec()],
      LATER,
    );
    const opsAfter = next.items.find((i) => i.domain === "ops")!;
    assert.ok(opsAfter.auditIds.includes("mixed"));
    assert.equal(opsAfter.freshness, "stale");
  });
});

// ─── an all-null batch returns the prior briefing UNCHANGED (same reference) ──────

describe("delta-consumer — empty / all-null input", () => {
  it("an all-null batch returns the prior briefing unchanged (same reference)", () => {
    const prior = priorBriefing();
    const next = applyDispatchDeltas(prior, [noExec(), noExec()], LATER);
    assert.equal(next, prior, "no executed deltas → same briefing reference, not re-synthesized");
    // generatedAt is NOT bumped for a no-op refresh.
    assert.equal(next.generatedAt, NOW_ISO);
  });

  it("an empty batch returns the prior briefing unchanged (same reference)", () => {
    const prior = priorBriefing();
    const next = applyDispatchDeltas(prior, [], LATER);
    assert.equal(next, prior, "empty batch → same briefing reference");
    assert.equal(next.generatedAt, NOW_ISO);
  });
});

// ─── §19 preserved (asserted via the Brain's behavior, not a reimplementation) ───

describe("delta-consumer — §19 preserved through the Brain's path", () => {
  it("a DEAD executed delta degrades a high-confidence item; it does not stay 'high'", () => {
    const prior = assembleBriefing({
      signals: [fleetSignal("ops", "ops", { verdict: "urgent", confidence: "high", freshness: "live" })],
      now: NOW,
    });
    const next = applyDispatchDeltas(
      prior,
      [executed(delta({ domain: "ops", freshness: "dead", auditId: "audit-dead" }))],
      LATER,
    );
    const item = next.items[0]!;
    assert.notEqual(item.confidence, "high", "stale/dead evidence must degrade confidence (§19)");
    assert.equal(item.freshness, "dead", "freshness takes the worst contributing band");
    assert.ok(item.auditIds.includes("audit-dead"));
  });

  it("a freshness-only (live) executed delta can never UPGRADE confidence", () => {
    const prior = assembleBriefing({
      signals: [fleetSignal("ops", "ops", { verdict: "urgent", confidence: "medium", freshness: "live" })],
      now: NOW,
    });
    const next = applyDispatchDeltas(
      prior,
      [executed(delta({ domain: "ops", freshness: "live", auditId: "audit-live" }))],
      LATER,
    );
    assert.equal(next.items[0]!.confidence, "medium", "a delta carries no confidence — cannot upgrade");
  });
});

// ─── determinism ─────────────────────────────────────────────────────────────────

describe("delta-consumer — determinism", () => {
  it("same inputs twice → deep-equal briefing", () => {
    const build = (): FleetBriefing =>
      applyDispatchDeltas(
        priorBriefing(),
        [
          executed(delta({ domain: "ops", freshness: "fresh", auditId: "audit-det" })),
          noExec(),
        ],
        LATER,
      );
    assert.deepEqual(build(), build());
  });
});
