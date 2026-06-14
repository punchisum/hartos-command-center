/**
 * tests/research-council-adapter.test.ts
 *
 * P7 Council Seam 2 — TDD for researchCouncilBrain.
 *
 * No real network; all injected env or mocked paths.
 * Tests:
 *   1. Lightweight mode returns a low-confidence honest result with unknowns-as-risks.
 *   2. The adapter never throws (even if planResearch were somehow broken, we guard).
 *   3. Full-mode-but-gather-off falls back to lightweight (honest unknowns, no gathering).
 *   4. Confidence mapping: "unknown" → "low"; "low" → "low"; "medium" → "medium"; "high" → "high".
 *   5. isLightweightMode defaults to true (zero-cost plain run).
 *   6. Lightweight result contains "Unknown:" prefixed risks from dossier unknowns.
 *   7. The adapter result never has undefined/null summary or risks.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  researchCouncilBrain,
  mapConfidence,
  isLightweightMode,
  COUNCIL_RESEARCH_LIGHTWEIGHT_FLAG,
} from "../src/research/research-council-adapter.js";
import type { CouncilGoal } from "../src/council/council-types.js";
import type { ResearchConfidence } from "../src/research/research-synthesis.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const GOAL: CouncilGoal = { goal: "compare Postgres and SQLite for an edge app", context: "MVP" };
const SPARSE_GOAL: CouncilGoal = { goal: "ok" }; // short, triggers NEEDS_SCOPING

/** A lightweight env (all flags absent). */
const LIGHTWEIGHT_ENV: Record<string, string | undefined> = {};

/** An env that ASKS for full mode but has the gather flag OFF. */
const FULL_MODE_GATHER_OFF: Record<string, string | undefined> = {
  [COUNCIL_RESEARCH_LIGHTWEIGHT_FLAG]: "false",
  // HARTOS_RESEARCH_GATHER deliberately absent → gather not armed
};

/** An env that sets lightweight=false but no LLM keys → still lightweight. */
const FULL_MODE_NO_KEYS: Record<string, string | undefined> = {
  [COUNCIL_RESEARCH_LIGHTWEIGHT_FLAG]: "false",
  HARTOS_RESEARCH_GATHER: "true",
  HARTOS_LLM_ENABLE_NETWORK: "true",
  // OPENAI_API_KEY absent → LLM gate closed → adapter falls to lightweight
};

// ── mapConfidence ─────────────────────────────────────────────────────────────

describe("mapConfidence", () => {
  it("maps 'unknown' → 'low'", () => {
    assert.equal(mapConfidence("unknown" as ResearchConfidence), "low");
  });

  it("maps 'low' → 'low'", () => {
    assert.equal(mapConfidence("low"), "low");
  });

  it("maps 'medium' → 'medium'", () => {
    assert.equal(mapConfidence("medium"), "medium");
  });

  it("maps 'high' → 'high'", () => {
    assert.equal(mapConfidence("high"), "high");
  });
});

// ── isLightweightMode ─────────────────────────────────────────────────────────

describe("isLightweightMode", () => {
  it("defaults to true when flag is absent", () => {
    assert.equal(isLightweightMode({}), true);
  });

  it("is true when flag is 'true' (explicit lightweight)", () => {
    assert.equal(isLightweightMode({ [COUNCIL_RESEARCH_LIGHTWEIGHT_FLAG]: "true" }), true);
  });

  it("is true when flag='false' but gather not armed", () => {
    assert.equal(isLightweightMode({ [COUNCIL_RESEARCH_LIGHTWEIGHT_FLAG]: "false" }), true);
  });

  it("is true when flag='false', gather armed, but network+key absent", () => {
    assert.equal(
      isLightweightMode({
        [COUNCIL_RESEARCH_LIGHTWEIGHT_FLAG]: "false",
        HARTOS_RESEARCH_GATHER: "true",
        // no HARTOS_LLM_ENABLE_NETWORK, no OPENAI_API_KEY
      }),
      true,
    );
  });

  it("is false only when flag='false' AND gather=true AND network=true AND key present", () => {
    assert.equal(
      isLightweightMode({
        [COUNCIL_RESEARCH_LIGHTWEIGHT_FLAG]: "false",
        HARTOS_RESEARCH_GATHER: "true",
        HARTOS_LLM_ENABLE_NETWORK: "true",
        OPENAI_API_KEY: "sk-test-key",
      }),
      false,
    );
  });
});

// ── researchCouncilBrain — lightweight mode ───────────────────────────────────

describe("researchCouncilBrain — lightweight (default)", () => {
  it("returns a result with confidence 'low' (no sources gathered → 'unknown' mapped to 'low')", async () => {
    const result = await researchCouncilBrain(GOAL, LIGHTWEIGHT_ENV);
    assert.equal(result.confidence, "low");
  });

  it("returns a non-empty summary (the dossier's honest 'no sources gathered' line)", async () => {
    const result = await researchCouncilBrain(GOAL, LIGHTWEIGHT_ENV);
    assert.ok(typeof result.summary === "string" && result.summary.length > 0, "summary must be a non-empty string");
  });

  it("returns risks prefixed with 'Unknown:'", async () => {
    const result = await researchCouncilBrain(GOAL, LIGHTWEIGHT_ENV);
    assert.ok(Array.isArray(result.risks), "risks must be an array");
    // All risks come from dossier.unknowns and are prefixed "Unknown: "
    assert.ok(
      result.risks.every((r) => r.startsWith("Unknown: ")),
      `all risks must start with 'Unknown: ', got: ${JSON.stringify(result.risks)}`,
    );
  });

  it("risks are drawn from the plan's sub-questions (honest unknowns, never fabricated)", async () => {
    const result = await researchCouncilBrain(GOAL, LIGHTWEIGHT_ENV);
    // Each risk mentions the 'Unanswered until sources are gathered' marker the planner/synthesis emits
    assert.ok(
      result.risks.every((r) => r.includes("Unanswered")),
      `risks must mention 'Unanswered', got: ${JSON.stringify(result.risks)}`,
    );
  });

  it("caps risks at MAX_RISKS (≤ 4)", async () => {
    const result = await researchCouncilBrain(GOAL, LIGHTWEIGHT_ENV);
    assert.ok(result.risks.length <= 4, `risks should be ≤ 4, got ${result.risks.length}`);
  });

  it("works for a short/scoped goal (NEEDS_SCOPING verdict — plan still returns unknowns)", async () => {
    const result = await researchCouncilBrain(SPARSE_GOAL, LIGHTWEIGHT_ENV);
    assert.equal(result.confidence, "low");
    assert.ok(typeof result.summary === "string");
    assert.ok(Array.isArray(result.risks));
  });
});

// ── researchCouncilBrain — never throws ──────────────────────────────────────

describe("researchCouncilBrain — never throws", () => {
  it("does not throw for a normal goal", async () => {
    let threw = false;
    try {
      await researchCouncilBrain(GOAL, LIGHTWEIGHT_ENV);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "adapter must never throw");
  });

  it("does not throw for an empty goal string", async () => {
    let threw = false;
    try {
      await researchCouncilBrain({ goal: "" }, LIGHTWEIGHT_ENV);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "adapter must never throw for empty goal");
  });

  it("does not throw for an extremely long/weird goal", async () => {
    let threw = false;
    try {
      await researchCouncilBrain({ goal: "a".repeat(5000) }, LIGHTWEIGHT_ENV);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "adapter must never throw for long goal");
  });

  it("result shape is always complete even on degraded path", async () => {
    const result = await researchCouncilBrain({ goal: "" }, LIGHTWEIGHT_ENV);
    assert.ok("summary" in result, "result must have summary");
    assert.ok("confidence" in result, "result must have confidence");
    assert.ok("risks" in result, "result must have risks");
    assert.ok(["low", "medium", "high"].includes(result.confidence), `confidence must be a valid band, got ${result.confidence}`);
  });
});

// ── researchCouncilBrain — full mode with gather OFF ─────────────────────────

describe("researchCouncilBrain — full-mode flag set but gather not armed → lightweight fallback", () => {
  it("falls back to lightweight (honest unknowns) when gather flag is off", async () => {
    const result = await researchCouncilBrain(GOAL, FULL_MODE_GATHER_OFF);
    // Full mode can't gather → falls to lightweight → unknown → low
    assert.equal(result.confidence, "low");
    assert.ok(
      result.risks.every((r) => r.startsWith("Unknown: ")),
      "fall-back must produce Unknown: prefixed risks",
    );
  });

  it("falls back to lightweight when full-mode flag='false' but LLM key absent", async () => {
    const result = await researchCouncilBrain(GOAL, FULL_MODE_NO_KEYS);
    assert.equal(result.confidence, "low");
    assert.ok(Array.isArray(result.risks));
  });
});

// ── Result shape invariants ───────────────────────────────────────────────────

describe("researchCouncilBrain — result shape invariants", () => {
  it("summary is always a non-null string", async () => {
    const result = await researchCouncilBrain(GOAL, LIGHTWEIGHT_ENV);
    assert.ok(typeof result.summary === "string");
    assert.notEqual(result.summary, null);
    assert.notEqual(result.summary, undefined);
  });

  it("risks is always an array (never null/undefined)", async () => {
    const result = await researchCouncilBrain(GOAL, LIGHTWEIGHT_ENV);
    assert.ok(Array.isArray(result.risks));
  });

  it("confidence is one of 'low'|'medium'|'high'", async () => {
    const result = await researchCouncilBrain(GOAL, LIGHTWEIGHT_ENV);
    assert.ok(["low", "medium", "high"].includes(result.confidence));
  });
});
