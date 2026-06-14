/**
 * tests/research-council-adapter.test.ts
 *
 * P7 Council Seam 2 — TDD for researchCouncilBrain.
 *
 * No real network; all injected env or mocked paths.
 * Tests:
 *   1. Lightweight mode returns a low-confidence honest result with unknowns-as-risks.
 *   1b. Lightweight mode returns degraded:true (no sources gathered).
 *   2. The adapter never throws (even if planResearch were somehow broken, we guard).
 *   3. Full-mode-but-gather-off falls back to lightweight (honest unknowns, no gathering).
 *   4. Confidence mapping: "unknown" → "low"; "low" → "low"; "medium" → "medium"; "high" → "high".
 *   5. isLightweightMode defaults to true (zero-cost plain run).
 *   6. Lightweight result contains "Unknown:" prefixed risks from dossier unknowns.
 *   7. The adapter result never has undefined/null summary or risks.
 *   8. Full-gather (injected fake Claude infer returning sources) → degraded:false + real summary.
 *   9. isLightweightMode gates on CLAUDE_CODE_OAUTH_TOKEN (not OpenAI key) for full mode.
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
import type { ClaudeResearchInfer } from "../src/research/research-claude.js";

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

/** An env that sets lightweight=false + gather armed, but no Claude token → still lightweight. */
const FULL_MODE_NO_CLAUDE_TOKEN: Record<string, string | undefined> = {
  [COUNCIL_RESEARCH_LIGHTWEIGHT_FLAG]: "false",
  HARTOS_RESEARCH_GATHER: "true",
  // CLAUDE_CODE_OAUTH_TOKEN absent → Claude-on-Max gate closed → adapter falls to lightweight
};

/** An env that fully arms full-gather mode (all three gates). */
const FULL_GATHER_ENV: Record<string, string | undefined> = {
  [COUNCIL_RESEARCH_LIGHTWEIGHT_FLAG]: "false",
  HARTOS_RESEARCH_GATHER: "true",
  CLAUDE_CODE_OAUTH_TOKEN: "oauth-test-token",
};

/** A fake Claude infer that returns real sources for any sub-question. */
const fakeClaudeInferWithSources: ClaudeResearchInfer = async (_subQ, _topic) => ({
  answer: "Postgres is better for ACID compliance; SQLite is lighter for embedded use.",
  sources: [{ url: "https://example.com/pg-vs-sqlite", title: "Postgres vs SQLite comparison" }],
});

/** A fake Claude infer that always returns null (simulates Claude unavailable). */
const fakeClaudeInferNull: ClaudeResearchInfer = async () => null;

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

  it("is true when flag='false', gather armed, but CLAUDE_CODE_OAUTH_TOKEN absent", () => {
    assert.equal(
      isLightweightMode({
        [COUNCIL_RESEARCH_LIGHTWEIGHT_FLAG]: "false",
        HARTOS_RESEARCH_GATHER: "true",
        // no CLAUDE_CODE_OAUTH_TOKEN → Claude-on-Max gate closed
      }),
      true,
    );
  });

  it("is false only when flag='false' AND gather=true AND CLAUDE_CODE_OAUTH_TOKEN present", () => {
    assert.equal(
      isLightweightMode({
        [COUNCIL_RESEARCH_LIGHTWEIGHT_FLAG]: "false",
        HARTOS_RESEARCH_GATHER: "true",
        CLAUDE_CODE_OAUTH_TOKEN: "oauth-token",
      }),
      false,
    );
  });

  it("is true when OPENAI_API_KEY is present but CLAUDE_CODE_OAUTH_TOKEN is absent (OpenAI no longer gates full mode)", () => {
    assert.equal(
      isLightweightMode({
        [COUNCIL_RESEARCH_LIGHTWEIGHT_FLAG]: "false",
        HARTOS_RESEARCH_GATHER: "true",
        HARTOS_LLM_ENABLE_NETWORK: "true",
        OPENAI_API_KEY: "sk-test-key",
        // CLAUDE_CODE_OAUTH_TOKEN still absent → lightweight
      }),
      true,
    );
  });
});

// ── researchCouncilBrain — lightweight mode ───────────────────────────────────

describe("researchCouncilBrain — lightweight (default)", () => {
  it("returns a result with confidence 'low' (no sources gathered → 'unknown' mapped to 'low')", async () => {
    const result = await researchCouncilBrain(GOAL, LIGHTWEIGHT_ENV);
    assert.equal(result.confidence, "low");
  });

  it("returns degraded:true (no sources were actually gathered)", async () => {
    const result = await researchCouncilBrain(GOAL, LIGHTWEIGHT_ENV);
    assert.equal(result.degraded, true, "lightweight must set degraded:true — no sources gathered");
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
    assert.equal(result.degraded, true);
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
    assert.ok("degraded" in result, "result must have degraded");
    assert.ok(["low", "medium", "high"].includes(result.confidence), `confidence must be a valid band, got ${result.confidence}`);
  });
});

// ── researchCouncilBrain — full mode with gather OFF ─────────────────────────

describe("researchCouncilBrain — full-mode flag set but gather not armed → lightweight fallback", () => {
  it("falls back to lightweight (honest unknowns, degraded:true) when gather flag is off", async () => {
    const result = await researchCouncilBrain(GOAL, FULL_MODE_GATHER_OFF);
    // Full mode can't gather → falls to lightweight → unknown → low, degraded:true
    assert.equal(result.confidence, "low");
    assert.equal(result.degraded, true);
    assert.ok(
      result.risks.every((r) => r.startsWith("Unknown: ")),
      "fall-back must produce Unknown: prefixed risks",
    );
  });

  it("falls back to lightweight (degraded:true) when full-mode flag='false' but Claude token absent", async () => {
    const result = await researchCouncilBrain(GOAL, FULL_MODE_NO_CLAUDE_TOKEN);
    assert.equal(result.confidence, "low");
    assert.equal(result.degraded, true);
    assert.ok(Array.isArray(result.risks));
  });
});

// ── researchCouncilBrain — full-gather mode ───────────────────────────────────

describe("researchCouncilBrain — full-gather mode (Claude-on-Max)", () => {
  it("full-gather with fake Claude infer returning sources → degraded:false + real summary", async () => {
    const result = await researchCouncilBrain(GOAL, FULL_GATHER_ENV, fakeClaudeInferWithSources);
    // At least 1 source was gathered → non-degraded
    assert.equal(result.degraded, false, "full-gather with real sources must set degraded:false");
    assert.ok(typeof result.summary === "string" && result.summary.length > 0, "summary must be non-empty");
    assert.ok(["low", "medium", "high"].includes(result.confidence), "confidence must be a valid band");
    assert.ok(Array.isArray(result.risks), "risks must be an array");
  });

  it("full-gather with Claude infer returning null (unavailable) → falls back to lightweight (degraded:true)", async () => {
    const result = await researchCouncilBrain(GOAL, FULL_GATHER_ENV, fakeClaudeInferNull);
    // Claude unavailable → zero sources → falls back to lightweight → degraded:true
    assert.equal(result.degraded, true, "zero-sources gather must fall back to degraded:true");
    assert.equal(result.confidence, "low");
  });

  it("full-gather → never throws even when infer throws", async () => {
    const throwingInfer: ClaudeResearchInfer = async () => { throw new Error("infer kaboom"); };
    let threw = false;
    try {
      await researchCouncilBrain(GOAL, FULL_GATHER_ENV, throwingInfer);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "adapter must never throw even when infer throws");
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

  it("degraded is always a boolean", async () => {
    const result = await researchCouncilBrain(GOAL, LIGHTWEIGHT_ENV);
    assert.equal(typeof result.degraded, "boolean", "degraded must always be a boolean");
  });
});
