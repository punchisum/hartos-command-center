/**
 * tests/council-specialists.test.ts
 *
 * Task 2.3 — TDD tests for buildCouncilSpecialists + councilInferFromEnv.
 * Injected infer + injected brains — no network, no real LLM.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCouncilSpecialists,
  councilInferFromEnv,
  type CouncilBrains,
} from "../src/council/council-specialists.js";
import type { CouncilGoal } from "../src/council/council-types.js";
import type { Specialist } from "../src/council/specialist.js";

const TEST_GOAL: CouncilGoal = { goal: "build a SaaS CRM", context: "MVP scope" };

/** Deterministic infer that returns a valid specialist JSON string. */
function makeInfer(confidence: "low" | "medium" | "high" = "medium") {
  return async (_p: { system: string; user: string }) =>
    JSON.stringify({ summary: "test summary", confidence, risks: ["risk A"] });
}

/** Deterministic brains set (all present). */
function makeBrains(): CouncilBrains {
  return {
    research: async (goal: CouncilGoal) => ({
      summary: `research on: ${goal.goal}`,
      confidence: "medium" as const,
      risks: [],
    }),
  };
}

describe("buildCouncilSpecialists (Task 2.3)", () => {
  it("returns an object with all 5 specialist ids: research, cto, financial, ma, legal", async () => {
    const infer = makeInfer();
    const specialists = buildCouncilSpecialists(infer, makeBrains());
    const ids = specialists.map((s: Specialist) => s.id).sort();
    assert.deepEqual(ids, ["cto", "financial", "legal", "ma", "research"]);
  });

  it("cto specialist produces a non-degraded finding (injected infer succeeds)", async () => {
    const infer = makeInfer("high");
    const specialists = buildCouncilSpecialists(infer, makeBrains());
    const cto = specialists.find((s: Specialist) => s.id ==="cto");
    assert.ok(cto, "cto specialist must exist");
    const finding = await cto.run(TEST_GOAL);
    assert.equal(finding.specialistId, "cto");
    assert.equal(finding.degraded, false);
    assert.equal(finding.confidence, "high");
    assert.equal(finding.summary, "test summary");
  });

  it("financial specialist produces a non-degraded finding", async () => {
    const specialists = buildCouncilSpecialists(makeInfer(), makeBrains());
    const financial = specialists.find((s: Specialist) => s.id ==="financial");
    assert.ok(financial);
    const finding = await financial.run(TEST_GOAL);
    assert.equal(finding.degraded, false);
    assert.equal(finding.specialistId, "financial");
  });

  it("ma specialist produces a non-degraded finding", async () => {
    const specialists = buildCouncilSpecialists(makeInfer(), makeBrains());
    const ma = specialists.find((s: Specialist) => s.id ==="ma");
    assert.ok(ma);
    const finding = await ma.run(TEST_GOAL);
    assert.equal(finding.degraded, false);
    assert.equal(finding.specialistId, "ma");
  });

  it("legal specialist produces a non-degraded finding", async () => {
    const specialists = buildCouncilSpecialists(makeInfer(), makeBrains());
    const legal = specialists.find((s: Specialist) => s.id ==="legal");
    assert.ok(legal);
    const finding = await legal.run(TEST_GOAL);
    assert.equal(finding.degraded, false);
    assert.equal(finding.specialistId, "legal");
  });

  it("research specialist uses injected brain and is non-degraded", async () => {
    const specialists = buildCouncilSpecialists(makeInfer(), makeBrains());
    const research = specialists.find((s: Specialist) => s.id ==="research");
    assert.ok(research);
    const finding = await research.run(TEST_GOAL);
    assert.equal(finding.specialistId, "research");
    assert.equal(finding.degraded, false);
    assert.ok(finding.summary.includes("build a SaaS CRM"), `summary should mention goal, got: ${finding.summary}`);
  });

  it("research specialist degrades if brain throws", async () => {
    const brains: CouncilBrains = {
      research: async () => { throw new Error("brain offline"); },
    };
    const specialists = buildCouncilSpecialists(makeInfer(), brains);
    const research = specialists.find((s: Specialist) => s.id ==="research");
    assert.ok(research);
    const finding = await research.run(TEST_GOAL);
    assert.equal(finding.degraded, true);
    assert.equal(finding.confidence, "low");
  });

  it("LLM specialist degrades gracefully when infer throws", async () => {
    const throwingInfer = async (_p: { system: string; user: string }): Promise<string> => {
      throw new Error("infer kaboom");
    };
    const specialists = buildCouncilSpecialists(throwingInfer, makeBrains());
    const cto = specialists.find((s: Specialist) => s.id ==="cto");
    assert.ok(cto);
    const finding = await cto.run(TEST_GOAL);
    assert.equal(finding.degraded, true);
    assert.equal(finding.confidence, "low");
  });

  it("LLM specialist degrades gracefully when infer returns unparseable output", async () => {
    const badInfer = async (_p: { system: string; user: string }) => "not json at all";
    const specialists = buildCouncilSpecialists(badInfer, makeBrains());
    const cto = specialists.find((s: Specialist) => s.id ==="cto");
    assert.ok(cto);
    const finding = await cto.run(TEST_GOAL);
    assert.equal(finding.degraded, true);
  });
});

describe("councilInferFromEnv (Task 2.3)", () => {
  it("with LLM disarmed → returns an Infer that never throws", async () => {
    // disarmed env — no network keys, no enable flag
    const infer = councilInferFromEnv({});
    // Should never throw; may return a deterministic stub string
    const result = await infer({ system: "sys", user: "user" });
    assert.equal(typeof result, "string", "infer must return a string even when disarmed");
  });

  it("returns a string result (honest fallback even when no LLM available)", async () => {
    const infer = councilInferFromEnv({ HARTOS_LLM_PROVIDER: "deterministic" });
    const result = await infer({ system: "be a specialist", user: "goal: test" });
    assert.equal(typeof result, "string");
    // The result doesn't need to be valid JSON — the parseFinding in makeLlmSpecialist handles that
    // by degrading gracefully. But it must be a non-throwing string.
    assert.ok(result.length >= 0);
  });

  it("never throws regardless of env", async () => {
    const infer = councilInferFromEnv({ HARTOS_LLM_PROVIDER: "openai" /* no key */ });
    let threw = false;
    try {
      await infer({ system: "s", user: "u" });
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "councilInferFromEnv result must never throw");
  });
});
