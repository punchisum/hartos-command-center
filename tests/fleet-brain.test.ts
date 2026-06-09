/**
 * tests/fleet-brain.test.ts — SLICE M (hermetic, injected timestamp).
 *
 * The Fleet Brain is a PURE rule-first synthesizer: signals + proposals + StateDeltaSignals →
 * a prioritized briefing, updated INCREMENTALLY from deltas. These tests pin: empty→empty;
 * honest owner resolution (incl. an unregistered domain surfaced, not dropped); a pending
 * proposal → proposedAction + its blockedReason as exactBlocker; §19 honesty (a high-confidence
 * signal + a stale/dead delta must NOT stay 'high'); incremental applyDeltas mutating ONLY the
 * matching item (others byte-identical); and determinism (same input twice → deep-equal).
 *
 * No env / network / fs / ambient clock: every `now` is injected.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assembleBriefing,
  applyDeltas,
  clampConfidence,
  resolveOwnerAgent,
  type FleetBriefing,
} from "../src/fleet/fleet-brain.js";
import type { FleetSignal, AgentSignal } from "../src/read-models/agent-signal.js";
import type { ProposalQueueItem } from "../src/cockpit/proposals/proposal-types.js";
import type { StateDeltaSignal } from "../src/execution/state-delta.js";

const NOW = new Date("2026-06-09T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();

// ─── Fixtures (all explicit — no hidden defaults that read the clock) ────────────

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

function proposal(over: Partial<ProposalQueueItem> = {}): ProposalQueueItem {
  return {
    id: "prop-1",
    domain: "ops",
    actionType: "ops_followup_plan",
    title: "Follow up on waiting card",
    description: "A card has been waiting on Hart for 3 days.",
    sourceIntent: "resurface the waiting ops card",
    proposedPayload: {},
    expectedEffect: "the card is resurfaced",
    riskLevel: "medium",
    requiredApproval: "Hart",
    createdAt: NOW_ISO,
    expiresAt: null,
    safetyNotes: [],
    blockedReason: "execution disabled in Phase 14A",
    dryRunResult: null,
    executable: false,
    status: "pending_approval",
    updatedAt: NOW_ISO,
    auditEvents: [],
    ...over,
  };
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

// ─── empty → empty ───────────────────────────────────────────────────────────────

describe("fleet-brain — empty", () => {
  it("no signals / proposals / deltas → an empty (but timestamped) briefing", () => {
    const b = assembleBriefing({ signals: [], now: NOW });
    assert.deepEqual(b.items, []);
    assert.equal(b.generatedAt, NOW_ISO);
  });
});

// ─── owner resolution (honest about unregistered domains) ────────────────────────

describe("fleet-brain — owner resolution", () => {
  it("resolves a registered signal type to its agent name", () => {
    assert.equal(resolveOwnerAgent("ops"), "Ops");
    assert.equal(resolveOwnerAgent("fitness"), "Fitness");
  });

  it("surfaces an unregistered domain honestly instead of dropping it", () => {
    // "factory" is a valid ProposalDomain but has no FLEET_REGISTRY entry.
    assert.equal(resolveOwnerAgent("factory"), "factory (no registered agent)");
    const b = assembleBriefing({
      signals: [],
      proposals: [proposal({ id: "p-factory", domain: "factory", title: "Build plan ready" })],
      now: NOW,
    });
    assert.equal(b.items.length, 1, "the unregistered-domain item is surfaced, not dropped");
    assert.equal(b.items[0]!.ownerAgent, "factory (no registered agent)");
  });
});

// ─── a pending proposal → proposedAction + blockedReason as exactBlocker ─────────

describe("fleet-brain — pending proposal", () => {
  it("surfaces proposedAction and uses the proposal's blockedReason as exactBlocker", () => {
    const b = assembleBriefing({
      signals: [],
      proposals: [proposal({ blockedReason: "execution disabled in Phase 14A" })],
      now: NOW,
    });
    const item = b.items[0]!;
    assert.equal(item.proposedAction, "resurface the waiting ops card");
    assert.equal(item.exactBlocker, "execution disabled in Phase 14A");
    assert.match(item.riskIfIgnored, /risk medium/);
  });

  it("a non-pending (rejected) proposal has no proposedAction", () => {
    const b = assembleBriefing({
      signals: [],
      proposals: [proposal({ status: "rejected", blockedReason: "" })],
      now: NOW,
    });
    assert.equal(b.items[0]!.proposedAction, null);
  });
});

// ─── §19 honesty: a high-confidence signal + a stale/dead delta is NOT 'high' ────

describe("fleet-brain — §19 no confidence laundering", () => {
  it("clampConfidence takes the weakest band and degrades on stale evidence", () => {
    assert.equal(clampConfidence(["high", "low"], "live"), "low", "weakest band wins");
    assert.equal(clampConfidence(["high"], "stale"), "medium", "stale degrades one band");
    assert.equal(clampConfidence(["high"], "dead"), "medium", "dead degrades one band");
    assert.equal(clampConfidence(["low"], "dead"), "unknown", "degrade floors at unknown");
    assert.equal(clampConfidence([], "live"), "unknown", "no bands → unknown");
  });

  it("a high-confidence signal folded with a DEAD delta does not stay 'high'", () => {
    const b = assembleBriefing({
      signals: [fleetSignal("ops", "ops", { verdict: "urgent", confidence: "high", freshness: "live" })],
      deltas: [delta({ domain: "ops", freshness: "dead", auditId: "audit-dead" })],
      now: NOW,
    });
    const item = b.items[0]!;
    assert.notEqual(item.confidence, "high", "stale/dead evidence must degrade confidence (§19)");
    assert.equal(item.freshness, "dead", "freshness takes the worst contributing band");
    assert.ok(item.auditIds.includes("audit-dead"), "the touching delta's auditId is recorded");
  });

  it("a freshness-only delta can never UPGRADE confidence", () => {
    // A 'live' delta on an already-medium item leaves confidence at medium — never bumps to high.
    const b = assembleBriefing({
      signals: [fleetSignal("ops", "ops", { verdict: "urgent", confidence: "medium", freshness: "live" })],
      deltas: [delta({ domain: "ops", freshness: "live", auditId: "audit-live" })],
      now: NOW,
    });
    assert.equal(b.items[0]!.confidence, "medium", "a delta carries no confidence — cannot upgrade");
  });
});

// ─── incremental applyDeltas mutates ONLY the matching item ──────────────────────

describe("fleet-brain — incremental applyDeltas", () => {
  it("touches ONLY the matching item; others are byte-identical (same reference)", () => {
    const prior = assembleBriefing({
      signals: [
        fleetSignal("ops", "ops", { verdict: "urgent", confidence: "high", freshness: "live" }),
        fleetSignal("fitness", "fitness", { verdict: "green", confidence: "high", freshness: "live" }),
      ],
      now: NOW,
    });
    const opsBefore = prior.items.find((i) => i.domain === "ops")!;
    const fitnessBefore = prior.items.find((i) => i.domain === "fitness")!;

    const later = new Date("2026-06-09T13:00:00.000Z");
    const next = applyDeltas(
      prior,
      [delta({ domain: "ops", freshness: "stale", auditId: "audit-ops-stale" })],
      later,
    );

    const opsAfter = next.items.find((i) => i.domain === "ops")!;
    const fitnessAfter = next.items.find((i) => i.domain === "fitness")!;

    // The fitness item is untouched → SAME object reference (no re-synthesis).
    assert.equal(fitnessAfter, fitnessBefore, "an untouched item is returned by reference");
    assert.deepEqual(fitnessAfter, fitnessBefore);

    // The ops item changed: freshness worsened, confidence degraded, auditId recorded.
    assert.notEqual(opsAfter, opsBefore, "the matched item is a new object");
    assert.equal(opsAfter.freshness, "stale");
    assert.notEqual(opsAfter.confidence, "high", "matched item confidence degraded (§19)");
    assert.ok(opsAfter.auditIds.includes("audit-ops-stale"));

    // The new timestamp is honest.
    assert.equal(next.generatedAt, later.toISOString());
  });

  it("a delta matching no item leaves the whole briefing byte-identical", () => {
    const prior = assembleBriefing({
      signals: [fleetSignal("fitness", "fitness", { verdict: "green", confidence: "high", freshness: "live" })],
      now: NOW,
    });
    const next = applyDeltas(
      prior,
      [delta({ domain: "ops", affectedAgents: ["Ops Agent"], auditId: "audit-nomatch" })],
      NOW,
    );
    assert.deepEqual(next.items, prior.items);
    assert.equal(next.items[0]!, prior.items[0]!, "no-match → same item reference");
  });
});

// ─── determinism ─────────────────────────────────────────────────────────────────

describe("fleet-brain — determinism", () => {
  it("the same input twice produces a deep-equal briefing (stable ranking)", () => {
    const build = (): FleetBriefing =>
      assembleBriefing({
        signals: [
          fleetSignal("ops", "ops", { verdict: "urgent", confidence: "high", freshness: "live" }),
          fleetSignal("fitness", "fitness", { verdict: "amber", confidence: "medium", freshness: "fresh" }),
        ],
        proposals: [
          proposal({ id: "p-a", domain: "ops", riskLevel: "high" }),
          proposal({ id: "p-b", domain: "fitness", riskLevel: "low", actionType: "fitness_adjustment_plan" }),
        ],
        deltas: [delta({ domain: "ops", auditId: "audit-det", freshness: "fresh" })],
        now: NOW,
      });
    assert.deepEqual(build(), build());
  });

  it("ranking is stable: higher severity/risk first, then a deterministic id tiebreak", () => {
    const b = assembleBriefing({
      signals: [
        fleetSignal("fitness", "fitness", { verdict: "green", confidence: "high", freshness: "live" }),
        fleetSignal("ops", "ops", { verdict: "urgent", confidence: "high", freshness: "live" }),
      ],
      now: NOW,
    });
    // "urgent" (severity 3) ranks above "green" (severity 0) regardless of input order.
    assert.equal(b.items[0]!.domain, "ops");
    assert.equal(b.items[1]!.domain, "fitness");
  });
});
