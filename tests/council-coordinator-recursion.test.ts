/**
 * tests/council-coordinator-recursion.test.ts
 *
 * Task 2.1 — TDD tests for coordinator recursion (depth-capped, sub-council bubbles up).
 * Plan 1 coordinator tests continue to live in council-coordinator.test.ts and must stay green.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runCouncil, type CouncilPorts } from "../src/council/council-coordinator.js";
import type { CouncilRunResult } from "../src/council/council-coordinator.js";

/** Deterministic leaf specialist that always succeeds. */
function leafFinding(id: string) {
  return { specialistId: id, lens: id, summary: `${id} finding`, confidence: "medium" as const, risks: [], degraded: false };
}

/** Base ports factory for recursion tests. */
function ports(over: Partial<CouncilPorts> = {}): CouncilPorts {
  return {
    isArmed: () => true,
    selectPanel: () => ["cto", "financial"],
    runSpecialist: async (id) => leafFinding(id),
    caps: { maxPanel: 5, maxLlmCalls: 30 },
    ...over,
  };
}

describe("runCouncil recursion (Task 2.1)", () => {
  // ── Regression: Plan 1 tests at depth=0 still produce a depth-1 tree ──────
  it("no sub-coordinator port → depth-1 tree exactly as Plan 1 (regression)", async () => {
    const r = await runCouncil({ goal: "build CRM" }, ports());
    assert.equal(r.skipped, false);
    assert.equal(r.payload?.tree.depth, 1);
    assert.equal(r.payload?.tree.children.length, 0);
  });

  // ── Sub-coordinator at depth 0 recurses and bubbles up ────────────────────
  it("sub-coordinator at depth 0 produces a child CouncilNode and a bubbled SpecialistFinding", async () => {
    let subDepthSeen = -1;
    const subResult: CouncilRunResult = {
      skipped: false,
      reason: "sub synthesized",
      payload: {
        rootGoal: "cto sub-goal",
        recommendation: "sub recommendation",
        confidence: "high",
        tree: {
          goal: { goal: "cto sub-goal" },
          panel: ["ma"],
          findings: [
            { specialistId: "ma", lens: "ma", summary: "m&a ok", confidence: "high", risks: [], degraded: false },
          ],
          synthesis: {
            recommendation: "sub recommendation",
            confidence: "high",
            consensus: ["ma: m&a ok"],
            dissent: [],
            truncated: false,
            notes: [],
          },
          children: [],
          depth: 2,
        },
        llmCallsUsed: 1,
      },
    };

    const p = ports({
      selectPanel: () => ["cto", "financial"],
      runSpecialist: async (id) => leafFinding(id),
      isSubCoordinator: (id) => id === "cto",
      runSubCouncil: async (goal, depth) => {
        subDepthSeen = depth;
        void goal;
        return subResult;
      },
    });

    const r = await runCouncil({ goal: "build CRM" }, p, 0);
    assert.equal(r.skipped, false);
    assert.ok(r.payload, "should have payload");

    // Sub-council was called at depth 1
    assert.equal(subDepthSeen, 1);

    // Root tree has one child node (the sub-council tree)
    assert.equal(r.payload.tree.children.length, 1);
    const child = r.payload.tree.children[0];
    assert.equal(child?.depth, 2);
    assert.equal(child?.goal.goal, "cto sub-goal");

    // The sub-coordinator's synthesis was folded in as a finding for the parent
    const ctoFinding = r.payload.tree.findings.find((f) => f.specialistId === "cto");
    assert.ok(ctoFinding, "cto finding must exist in parent");
    assert.equal(ctoFinding?.summary, "sub recommendation");
    assert.equal(ctoFinding?.confidence, "high");
    assert.equal(ctoFinding?.degraded, false);
  });

  // ── Skipped sub-council → degraded bubbled finding ────────────────────────
  it("skipped sub-council produces a degraded bubbled finding", async () => {
    const skippedResult: CouncilRunResult = {
      skipped: true,
      reason: "sub disarmed",
      payload: undefined,
    };

    const p = ports({
      selectPanel: () => ["cto"],
      runSpecialist: async (id) => leafFinding(id),
      isSubCoordinator: (id) => id === "cto",
      runSubCouncil: async () => skippedResult,
    });

    const r = await runCouncil({ goal: "test" }, p, 0);
    assert.equal(r.skipped, false);
    const ctoFinding = r.payload?.tree.findings.find((f) => f.specialistId === "cto");
    assert.ok(ctoFinding, "degraded cto finding must exist");
    assert.equal(ctoFinding?.degraded, true);
    assert.equal(ctoFinding?.confidence, "low");
  });

  // ── Depth cap: maxDepth stops recursion and runs as a leaf ────────────────
  it("at maxDepth-1, a sub-coordinator runs as a leaf specialist, not recursively", async () => {
    // COUNCIL_CAPS.maxDepth = 3; so at depth = 2 (depth+1 = 3 >= maxDepth) → no recurse
    let subCouncilCalled = false;
    let leafSpecialistCalled = false;

    const p = ports({
      selectPanel: () => ["cto"],
      runSpecialist: async (id) => {
        leafSpecialistCalled = true;
        return leafFinding(id);
      },
      isSubCoordinator: (id) => id === "cto",
      runSubCouncil: async () => {
        subCouncilCalled = true;
        return { skipped: false, reason: "sub ok", payload: undefined };
      },
    });

    // depth = 2, default maxDepth = 3 → depth+1 = 3 >= 3 → no recurse
    const r = await runCouncil({ goal: "test" }, p, 2);
    assert.equal(r.skipped, false);
    assert.equal(subCouncilCalled, false, "should NOT recurse at maxDepth-1");
    assert.equal(leafSpecialistCalled, true, "should run as leaf");
  });

  // ── Depth cap arithmetic edge: caps.maxDepth override ─────────────────────
  it("caps.maxDepth=1: sub-coordinator at depth 0 runs as a leaf (depth+1 >= maxDepth)", async () => {
    let subCalled = false;
    const p = ports({
      selectPanel: () => ["cto"],
      runSpecialist: async (id) => leafFinding(id),
      isSubCoordinator: (id) => id === "cto",
      runSubCouncil: async () => {
        subCalled = true;
        return { skipped: false, reason: "ok", payload: undefined };
      },
      caps: { maxPanel: 5, maxLlmCalls: 30, maxDepth: 1 },
    });

    const r = await runCouncil({ goal: "test" }, p, 0);
    assert.equal(r.skipped, false);
    assert.equal(subCalled, false, "maxDepth=1 should block all sub-council calls");
  });

  // ── Never-throw invariant (runSubCouncil throws) ──────────────────────────
  it("runSubCouncil that throws still produces a degraded finding (never-throw)", async () => {
    const p = ports({
      selectPanel: () => ["cto", "financial"],
      runSpecialist: async (id) => leafFinding(id),
      isSubCoordinator: (id) => id === "cto",
      runSubCouncil: async () => {
        throw new Error("sub-council kaboom");
      },
    });

    const r = await runCouncil({ goal: "test" }, p, 0);
    assert.equal(r.skipped, false);
    assert.ok(r.payload, "payload must still be present");
    const ctoFinding = r.payload?.tree.findings.find((f) => f.specialistId === "cto");
    assert.ok(ctoFinding, "degraded cto finding must exist after throw");
    assert.equal(ctoFinding?.degraded, true);
  });

  // ── llmCallsUsed accumulates sub-council calls ────────────────────────────
  it("llmCallsUsed includes sub-council llmCallsUsed when it succeeds", async () => {
    const subResult: CouncilRunResult = {
      skipped: false,
      reason: "ok",
      payload: {
        rootGoal: "sub",
        recommendation: "sub rec",
        confidence: "medium",
        tree: {
          goal: { goal: "sub" },
          panel: ["ma"],
          findings: [{ specialistId: "ma", lens: "ma", summary: "ok", confidence: "medium", risks: [], degraded: false }],
          synthesis: {
            recommendation: "sub rec", confidence: "medium",
            consensus: [], dissent: [], truncated: false, notes: [],
          },
          children: [],
          depth: 2,
        },
        llmCallsUsed: 5,
      },
    };

    const p = ports({
      selectPanel: () => ["cto", "financial"], // cto recurses (5 sub calls), financial is leaf (1 call)
      runSpecialist: async (id) => leafFinding(id),
      isSubCoordinator: (id) => id === "cto",
      runSubCouncil: async () => subResult,
    });

    const r = await runCouncil({ goal: "test" }, p, 0);
    // cto (sub: 5) + financial (leaf: 1) = 6
    assert.equal(r.payload?.llmCallsUsed, 6);
  });

  // ── children array is empty when no sub-coordinators ──────────────────────
  it("children array is empty when no specialist is a sub-coordinator", async () => {
    const p = ports({
      selectPanel: () => ["cto", "financial", "legal"],
      isSubCoordinator: () => false,
    });
    const r = await runCouncil({ goal: "test" }, p, 0);
    assert.equal(r.payload?.tree.children.length, 0);
  });
});
