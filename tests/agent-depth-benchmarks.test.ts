/**
 * tests/agent-depth-benchmarks.test.ts
 *
 * Agent Depth sprint — benchmark scenarios proving the Coach (fitness) and Operator (ops)
 * reasoning cores produce specialized, grounded risk/opportunity reasoning rather than
 * generic assistant output. Each core gets:
 *   - an EXCELLENT scenario (full signal → sharp, specific verdict + risk + opportunity)
 *   - a MEDIOCRE scenario (partial signal → conservative, honest about gaps)
 *   - a FAILURE scenario (no signal → refuses to fabricate)
 *
 * Hermetic + deterministic: pure cores, literal signals, no I/O.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { coach } from "../src/fitness/coaching-core.js";
import { triageOps } from "../src/ops/triage-core.js";

describe("Fitness Coach — depth benchmarks", () => {
  it("EXCELLENT: low recovery + hard plan → names the injury/overtraining risk, swaps the session", () => {
    const a = coach({ recoveryScore: 28, trainingPlan: "hard interval session", trainingCompleted: false, proteinHave: 60, proteinTarget: 180 });
    assert.equal(a.verdict, "prioritize_recovery");
    assert.equal(a.recoveryBand, "low");
    assert.ok(a.risk, "must name a concrete risk");
    assert.match(a.risk!, /injury|fatigue|back off/i, "risk must be specific, not generic");
    // Opportunity should surface the cheap recovery win (protein far behind).
    assert.ok(a.opportunity, "protein 60/180 is a concrete opportunity");
    assert.match(a.opportunity!, /protein/i);
    assert.notEqual(a.confidence, "low", "full signal → not low confidence");
  });

  it("EXCELLENT: high recovery + easy plan → flags unused capacity as the opportunity", () => {
    const a = coach({ recoveryScore: 85, trainingPlan: "easy zone 2 jog", trainingCompleted: false });
    assert.equal(a.verdict, "train_as_planned");
    assert.equal(a.recoveryBand, "high");
    assert.ok(a.opportunity, "high recovery on a light day is unused capacity");
    assert.match(a.opportunity!, /capacity|add/i);
    assert.equal(a.risk, null, "nothing concrete is at risk on a high-recovery easy day");
  });

  it("MEDIOCRE: recovery present but no plan → conservative, honest about the blind spot", () => {
    const a = coach({ recoveryScore: 50 });
    assert.equal(a.recoveryBand, "moderate");
    assert.ok(a.unknowns.includes("today's training plan"), "names the missing plan");
    assert.ok(a.confidence !== "high", "partial signal is not high confidence");
  });

  it("FAILURE: no signal → insufficient_data, never fabricates a verdict or risk", () => {
    const a = coach({});
    assert.equal(a.verdict, "insufficient_data");
    assert.equal(a.recoveryBand, "unknown");
    assert.equal(a.risk, null, "must not invent a risk from nothing");
    assert.equal(a.opportunity, null, "must not invent an opportunity from nothing");
    assert.equal(a.confidence, "low");
  });

  it("blind-flying: planned session with no recovery reading → risk says sync the wearable", () => {
    const a = coach({ trainingPlan: "hard tempo run" });
    assert.ok(a.risk, "training blind is a real risk");
    assert.match(a.risk!, /blind|sync/i);
  });
});

describe("Ops Operator — depth benchmarks", () => {
  it("EXCELLENT: blocked + stale → names the stall risk, urgent verdict, quick win from waiting", () => {
    const t = triageOps({ blocked: 3, stale: 4, waiting: 2, urgent: 1, activeCards: 20 });
    assert.equal(t.verdict, "urgent");
    // Impact frames halted work, not just a count.
    assert.match(t.impact, /halted|critical/i);
    // Stall risk = blocked AND stale together.
    assert.ok(t.risks.some((r) => /stall|dead project/i.test(r)), "must name the stall risk");
    // Opportunity = the cheap unblock (waiting cards).
    assert.ok(t.opportunity, "waiting cards are a quick win");
    assert.match(t.opportunity!, /quick win|unblock/i);
    assert.equal(t.confidence, "high", "breadth of counts → high confidence");
  });

  it("EXCELLENT: only waiting/approvals → act verdict, opportunity is the cheap decision clear", () => {
    const t = triageOps({ waiting: 2, pendingApprovals: 1, activeCards: 8 });
    assert.equal(t.verdict, "act");
    assert.ok(t.opportunity, "parked decisions are a quick win");
    assert.match(t.opportunity!, /decision|approval|quick win/i);
  });

  it("MEDIOCRE: counts present but import stale → confidence capped, risk names the stale import", () => {
    const t = triageOps({ urgent: 2, blocked: 1, syncStale: true });
    assert.equal(t.confidence, "medium", "stale import caps confidence at medium");
    assert.ok(t.risks.some((r) => /import is stale|lower bound/i.test(r)), "stale import is a named risk");
    assert.ok(t.caveats.length > 0);
  });

  it("FAILURE: no counts, no risk flags → insufficient_data, no fabricated all-clear", () => {
    const t = triageOps({});
    assert.equal(t.verdict, "insufficient_data");
    assert.equal(t.confidence, "low");
    assert.match(t.impact, /can't assess|isn't surfaced/i);
    assert.equal(t.opportunity, null, "must not invent a quick win from nothing");
  });

  it("CLEAR: counts present, all zero → clear verdict, impact says capacity is free", () => {
    const t = triageOps({ urgent: 0, blocked: 0, stale: 0, waiting: 0, activeCards: 5 });
    assert.equal(t.verdict, "clear");
    assert.match(t.impact, /free|no work/i);
  });
});
