/**
 * tests/council-spec-concretizer.test.ts
 *
 * TDD tests for the P7 council-spec-concretizer.
 *
 * All tests use injected infer fakes -- no real Claude, no network, no DB.
 * Covers:
 *   1. Valid infer response -> ConcreteAgentSpec returned.
 *   2. Malformed/non-JSON infer response -> null (fail-closed).
 *   3. Missing required fields in JSON -> null.
 *   4. Empty array fields -> null.
 *   5. Infer returns sentinel / empty string -> null.
 *   6. Infer throws -> null (never propagates).
 *   7. Code-fence-wrapped JSON -> parsed correctly.
 *   8. buildConcretizePrompt redacts secrets from goal/findings.
 *   9. parseConcretizeResponse trims whitespace from fields.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  concretizeCouncilToSpec,
  buildConcretizePrompt,
  parseConcretizeResponse,
  type ConcreteAgentSpec,
} from "../src/hartos/council-spec-concretizer.js";
import type { CouncilProposalPayload } from "../src/council/council-types.js";
import type { Infer } from "../src/council/specialist.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makePayload(over: Partial<CouncilProposalPayload> = {}): CouncilProposalPayload {
  return {
    rootGoal: "monitor fitness adherence and flag missed sessions in cockpit",
    recommendation:
      "Build a fitness-adherence monitoring agent: reads logged workouts from Supabase, flags missed sessions, surfaces cockpit proposals.",
    confidence: "medium",
    tree: {
      goal: { goal: "monitor fitness adherence and flag missed sessions in cockpit" },
      panel: ["cto", "fitness"],
      findings: [
        {
          specialistId: "cto",
          lens: "technical feasibility, architecture, effort estimation, and technical risk",
          summary:
            "feasible: Supabase read RPCs available (get_workout_sessions, get_adherence_score). " +
            "No mutation needed. Cockpit card via /agent/fitness/ui. Commands: read_sessions, compute_adherence, flag_missed.",
          confidence: "high",
          risks: ["data freshness depends on workout logging cadence"],
          degraded: false,
        },
        {
          specialistId: "fitness",
          lens: "fitness",
          summary: "useful: adherence gaps are high-value signal for weekly review",
          confidence: "medium",
          risks: ["definition of missed session needs clarification"],
          degraded: false,
        },
      ],
      synthesis: {
        recommendation: "Build the fitness-adherence agent.",
        confidence: "medium",
        consensus: ["feasible", "useful"],
        dissent: [],
        truncated: false,
        notes: [],
      },
      children: [],
      depth: 1,
    },
    llmCallsUsed: 4,
    ...over,
  };
}

/** Valid ConcreteAgentSpec JSON that the concretizer should accept. */
const VALID_SPEC_JSON: ConcreteAgentSpec = {
  agentName: "fitness-adherence-agent",
  capability: "reads workout sessions from Supabase and flags missed sessions in the cockpit",
  readSources: ["get_workout_sessions", "get_adherence_score"],
  output: "fitness read-model + flag_missed_session proposal",
  commands: ["read_sessions", "compute_adherence", "flag_missed"],
  interfaces: ["/agent/fitness/ui", "cockpit fleet card"],
  measurableAcceptance: "flags >=95% of missed sessions within 1 hour of occurrence",
  failureMode: "returns ok:false + no proposal if Supabase is unreachable; no silent failures",
};

function makeValidInfer(): Infer {
  return async (_prompt) => JSON.stringify(VALID_SPEC_JSON);
}

function makeInferReturning(text: string): Infer {
  return async (_prompt) => text;
}

function makeInferThrowing(): Infer {
  return async (_prompt) => {
    throw new Error("simulated infer crash");
  };
}

// ─── Tests: concretizeCouncilToSpec ──────────────────────────────────────────

describe("concretizeCouncilToSpec", () => {
  it("valid infer response -> returns ConcreteAgentSpec", async () => {
    const result = await concretizeCouncilToSpec(makePayload(), makeValidInfer());
    assert.ok(result !== null, "should return a ConcreteAgentSpec");
    assert.equal(result!.agentName, VALID_SPEC_JSON.agentName);
    assert.equal(result!.capability, VALID_SPEC_JSON.capability);
    assert.deepEqual(result!.readSources, VALID_SPEC_JSON.readSources);
    assert.equal(result!.output, VALID_SPEC_JSON.output);
    assert.deepEqual(result!.commands, VALID_SPEC_JSON.commands);
    assert.deepEqual(result!.interfaces, VALID_SPEC_JSON.interfaces);
    assert.equal(result!.measurableAcceptance, VALID_SPEC_JSON.measurableAcceptance);
    assert.equal(result!.failureMode, VALID_SPEC_JSON.failureMode);
  });

  it("non-JSON response -> null (fail-closed)", async () => {
    const result = await concretizeCouncilToSpec(makePayload(), makeInferReturning("This is strategic prose, not JSON."));
    assert.equal(result, null);
  });

  it("empty string response -> null", async () => {
    const result = await concretizeCouncilToSpec(makePayload(), makeInferReturning(""));
    assert.equal(result, null);
  });

  it("whitespace-only response -> null", async () => {
    const result = await concretizeCouncilToSpec(makePayload(), makeInferReturning("   \n  "));
    assert.equal(result, null);
  });

  it("claude sentinel string -> null", async () => {
    const result = await concretizeCouncilToSpec(makePayload(), makeInferReturning("(claude-infer failed)"));
    assert.equal(result, null);
  });

  it("infer throws -> null (never propagates)", async () => {
    let threw = false;
    let result: ConcreteAgentSpec | null = null;
    try {
      result = await concretizeCouncilToSpec(makePayload(), makeInferThrowing());
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "concretizeCouncilToSpec must never throw");
    assert.equal(result, null);
  });

  it("code-fence-wrapped JSON -> parsed correctly", async () => {
    const fenced = "```json\n" + JSON.stringify(VALID_SPEC_JSON) + "\n```";
    const result = await concretizeCouncilToSpec(makePayload(), makeInferReturning(fenced));
    assert.ok(result !== null, "should parse code-fence-wrapped JSON");
    assert.equal(result!.agentName, VALID_SPEC_JSON.agentName);
  });

  it("code-fence without language tag -> parsed correctly", async () => {
    const fenced = "```\n" + JSON.stringify(VALID_SPEC_JSON) + "\n```";
    const result = await concretizeCouncilToSpec(makePayload(), makeInferReturning(fenced));
    assert.ok(result !== null, "should parse unfenced code-fence JSON");
    assert.equal(result!.agentName, VALID_SPEC_JSON.agentName);
  });

  it("JSON missing agentName -> null", async () => {
    const bad = { ...VALID_SPEC_JSON };
    // @ts-expect-error intentional for test
    delete bad["agentName"];
    const result = await concretizeCouncilToSpec(makePayload(), makeInferReturning(JSON.stringify(bad)));
    assert.equal(result, null);
  });

  it("JSON with empty agentName -> null", async () => {
    const bad = { ...VALID_SPEC_JSON, agentName: "" };
    const result = await concretizeCouncilToSpec(makePayload(), makeInferReturning(JSON.stringify(bad)));
    assert.equal(result, null);
  });

  it("JSON with empty readSources array -> null", async () => {
    const bad = { ...VALID_SPEC_JSON, readSources: [] };
    const result = await concretizeCouncilToSpec(makePayload(), makeInferReturning(JSON.stringify(bad)));
    assert.equal(result, null);
  });

  it("JSON with empty commands array -> null", async () => {
    const bad = { ...VALID_SPEC_JSON, commands: [] };
    const result = await concretizeCouncilToSpec(makePayload(), makeInferReturning(JSON.stringify(bad)));
    assert.equal(result, null);
  });

  it("JSON with empty interfaces array -> null", async () => {
    const bad = { ...VALID_SPEC_JSON, interfaces: [] };
    const result = await concretizeCouncilToSpec(makePayload(), makeInferReturning(JSON.stringify(bad)));
    assert.equal(result, null);
  });

  it("JSON array at root -> null", async () => {
    const result = await concretizeCouncilToSpec(makePayload(), makeInferReturning(JSON.stringify([])));
    assert.equal(result, null);
  });

  it("JSON with null value for required string field -> null", async () => {
    const bad = { ...VALID_SPEC_JSON, capability: null };
    const result = await concretizeCouncilToSpec(makePayload(), makeInferReturning(JSON.stringify(bad)));
    assert.equal(result, null);
  });

  it("JSON with non-string item in readSources -> null", async () => {
    const bad = { ...VALID_SPEC_JSON, readSources: [42, "get_sessions"] };
    const result = await concretizeCouncilToSpec(makePayload(), makeInferReturning(JSON.stringify(bad)));
    assert.equal(result, null);
  });
});

// ─── Tests: buildConcretizePrompt ────────────────────────────────────────────

describe("buildConcretizePrompt", () => {
  it("returns a system and user field", () => {
    const { system, user } = buildConcretizePrompt(makePayload());
    assert.ok(typeof system === "string" && system.length > 0, "system must be non-empty");
    assert.ok(typeof user === "string" && user.length > 0, "user must be non-empty");
  });

  it("system prompt mentions concrete, buildable, read-only, propose-only", () => {
    const { system } = buildConcretizePrompt(makePayload());
    const lower = system.toLowerCase();
    assert.ok(lower.includes("concrete"), "system should mention concrete");
    assert.ok(lower.includes("read-only"), "system should mention read-only");
    assert.ok(lower.includes("propose-only"), "system should mention propose-only");
  });

  it("user section includes the redacted goal", () => {
    const payload = makePayload();
    const { user } = buildConcretizePrompt(payload);
    // The goal has no secrets so it should appear verbatim (or trimmed).
    assert.ok(
      user.includes(payload.rootGoal.slice(0, 30)),
      "user section should contain part of the rootGoal",
    );
  });

  it("user section includes specialist findings", () => {
    const payload = makePayload();
    const { user } = buildConcretizePrompt(payload);
    assert.ok(
      user.toLowerCase().includes("cto"),
      "user section should reference the CTO finding",
    );
  });

  it("secrets in goal are redacted before the LLM call", () => {
    const secretGoal =
      "monitor fitness with api key sk-abc1234567890123456789012 in cockpit";
    const payload = makePayload({ rootGoal: secretGoal });
    const { user } = buildConcretizePrompt(payload);
    assert.ok(
      !user.includes("sk-abc1234567890123456789012"),
      "secret key must be redacted from the user prompt",
    );
    assert.ok(user.includes("[REDACTED]"), "redacted placeholder must appear");
  });

  it("secrets in specialist findings are redacted", () => {
    const payload = makePayload();
    // Inject a fake secret into a finding summary.
    payload.tree.findings[0]!.summary += " bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.FAKESIG";
    const { user } = buildConcretizePrompt(payload);
    // The JWT-like pattern should be redacted.
    assert.ok(
      !user.includes("eyJhbGciOiJIUzI1NiJ9"),
      "JWT in finding should be redacted",
    );
  });
});

// ─── Tests: parseConcretizeResponse ──────────────────────────────────────────

describe("parseConcretizeResponse", () => {
  it("valid JSON -> ConcreteAgentSpec", () => {
    const result = parseConcretizeResponse(JSON.stringify(VALID_SPEC_JSON));
    assert.ok(result !== null);
    assert.equal(result!.agentName, VALID_SPEC_JSON.agentName);
  });

  it("whitespace-padded field values are trimmed", () => {
    const padded = {
      ...VALID_SPEC_JSON,
      agentName: "  fitness-adherence-agent  ",
      capability: "  reads workouts  ",
    };
    const result = parseConcretizeResponse(JSON.stringify(padded));
    assert.ok(result !== null);
    assert.equal(result!.agentName, "fitness-adherence-agent");
    assert.equal(result!.capability, "reads workouts");
  });

  it("garbage string -> null", () => {
    assert.equal(parseConcretizeResponse("not json at all"), null);
  });

  it("empty string -> null", () => {
    assert.equal(parseConcretizeResponse(""), null);
  });

  it("JSON null -> null", () => {
    assert.equal(parseConcretizeResponse("null"), null);
  });

  it("missing measurableAcceptance -> null", () => {
    const bad = { ...VALID_SPEC_JSON };
    // @ts-expect-error intentional for test
    delete bad["measurableAcceptance"];
    assert.equal(parseConcretizeResponse(JSON.stringify(bad)), null);
  });

  it("missing failureMode -> null", () => {
    const bad = { ...VALID_SPEC_JSON };
    // @ts-expect-error intentional for test
    delete bad["failureMode"];
    assert.equal(parseConcretizeResponse(JSON.stringify(bad)), null);
  });

  it("missing output -> null", () => {
    const bad = { ...VALID_SPEC_JSON };
    // @ts-expect-error intentional for test
    delete bad["output"];
    assert.equal(parseConcretizeResponse(JSON.stringify(bad)), null);
  });
});
