/**
 * tests/council-factory-bridge.test.ts
 *
 * TDD tests for the P7 council->factory bridge (updated for the P7 concretize pass).
 *
 * All tests use injected infer fakes + injected factory functions -- no DB, no real
 * Factory I/O, no network, no real Claude.
 *
 * The bridge signature is now:
 *   bridgeCouncilToFactory(payload, councilProposalId, now, infer, deps?) -> Promise<BridgeResult>
 *
 * Covers:
 *   1. Well-formed council payload with valid concretize + real compiler
 *      -> produces a factory/build_agent_plan pending_approval/executable:false proposal.
 *   2. Concretize returns null -> {ok:false} no proposal.
 *   3. Injected compileSpecToManifest throws -> {ok:false} no throw.
 *   4. validateManifest returns violations -> {ok:false} no throw.
 *   5. Idempotent id is stable (same councilProposalId -> same factoryProposalId).
 *   6. runCouncilBuildBridgeOnce disarmed -> silent [].
 *   7. buildInterrogationAnswers covers all 5 spec-lock dimensions + measurable criteria.
 *   8. Bridge never throws (outermost guard).
 *   9. Proposal carries concreteSpec in proposedPayload.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bridgeCouncilToFactory,
  makeFactoryProposalId,
  buildInterrogationAnswers,
  type CouncilFactoryBridgeDeps,
  type BridgeResult,
} from "../src/hartos/council-factory-bridge.js";
import { runCouncilBuildBridgeOnce } from "../scripts/run-council-build-bridge.js";
import type { CouncilProposalPayload } from "../src/council/council-types.js";
import type { Infer } from "../src/council/specialist.js";
import type { ConcreteAgentSpec } from "../src/hartos/council-spec-concretizer.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeCouncilPayload(
  over: Partial<CouncilProposalPayload> = {},
): CouncilProposalPayload {
  return {
    rootGoal: "monitor fitness adherence and flag missed sessions in cockpit",
    recommendation:
      "Build a fitness-adherence monitoring agent: reads logged workouts from Supabase, flags missed sessions, surfaces cockpit proposals. Confidence: medium.",
    confidence: "medium",
    tree: {
      goal: { goal: "monitor fitness adherence and flag missed sessions in cockpit" },
      panel: ["cto", "fitness"],
      findings: [
        {
          specialistId: "cto",
          lens: "cto",
          summary:
            "feasible: Supabase read RPCs available (get_workout_sessions, get_adherence_score). " +
            "Commands: read_sessions, compute_adherence, flag_missed. Interfaces: /agent/fitness/ui.",
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
        recommendation:
          "Build a fitness-adherence monitoring agent: reads logged workouts from Supabase, flags missed sessions, surfaces cockpit proposals. Confidence: medium.",
        confidence: "medium",
        consensus: ["feasible read-only Supabase approach", "useful adherence signal"],
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

const NOW = "2026-06-14T10:00:00.000Z";
const COUNCIL_ID = "prop-council-2026-06-14T10-00-00-000Z";

/** A valid ConcreteAgentSpec that the fake infer will return. */
const VALID_CONCRETE_SPEC: ConcreteAgentSpec = {
  agentName: "fitness-adherence-agent",
  capability: "reads workout sessions from Supabase and flags missed sessions in the cockpit",
  readSources: ["get_workout_sessions", "get_adherence_score"],
  output: "fitness read-model + flag_missed_session proposal",
  commands: ["read_sessions", "compute_adherence", "flag_missed"],
  interfaces: ["/agent/fitness/ui", "cockpit fleet card"],
  measurableAcceptance: "flags >=95% of missed sessions within 1 hour of occurrence",
  failureMode: "returns ok:false + no proposal if Supabase is unreachable; no silent failures",
};

/** Fake infer that returns a valid ConcreteAgentSpec JSON. */
function makeValidInfer(): Infer {
  return async (_prompt) => JSON.stringify(VALID_CONCRETE_SPEC);
}

/** Fake infer that triggers a null concretize result. */
function makeNullInfer(): Infer {
  return async (_prompt) => "(not json)";
}

/** Fake infer that throws. */
function makeThrowingInfer(): Infer {
  return async (_prompt) => {
    throw new Error("infer crash");
  };
}

/**
 * Deps that inject a fake concretize returning a valid ConcreteAgentSpec,
 * then use the real compiler/planner/validator for the rest of the lifecycle.
 */
function makeValidDeps(): CouncilFactoryBridgeDeps {
  return {
    concretizeCouncilToSpec: async (_payload, _infer) => VALID_CONCRETE_SPEC,
  };
}

/**
 * Deps that inject a null concretize (simulates LLM failure or thin result).
 */
function makeNullConcretizeDeps(): CouncilFactoryBridgeDeps {
  return {
    concretizeCouncilToSpec: async (_payload, _infer) => null,
  };
}

/**
 * Deps that inject a concretize returning a valid spec, but compileSpecToManifest throws.
 */
function makeCompileThrowsDeps(): CouncilFactoryBridgeDeps {
  return {
    concretizeCouncilToSpec: async (_payload, _infer) => VALID_CONCRETE_SPEC,
    compileSpecToManifest: (_spec) => {
      throw new Error("compile crashed");
    },
  };
}

/**
 * Deps that inject a concretize returning a valid spec, but validateManifest returns violations.
 */
function makeViolationDeps(): CouncilFactoryBridgeDeps {
  return {
    concretizeCouncilToSpec: async (_payload, _infer) => VALID_CONCRETE_SPEC,
    validateManifest: (_manifest) => [
      { facet: "read-model", detail: "injected violation for test" },
    ],
  };
}

// ─── Tests: bridgeCouncilToFactory ────────────────────────────────────────────

describe("bridgeCouncilToFactory", () => {
  it("well-formed payload with valid concretize + real compiler -> ok:true, domain=factory, actionType=build_agent_plan", async () => {
    const result = await bridgeCouncilToFactory(
      makeCouncilPayload(),
      COUNCIL_ID,
      NOW,
      makeValidInfer(),
      makeValidDeps(),
    );
    assert.equal(result.ok, true, `Expected ok:true, got reason: ${result.reason}`);
    assert.ok(result.proposal, "proposal must be present");
    assert.equal(result.proposal.domain, "factory");
    assert.equal(result.proposal.actionType, "build_agent_plan");
  });

  it("proposal has status=pending_approval and executable=false", async () => {
    const result = await bridgeCouncilToFactory(
      makeCouncilPayload(), COUNCIL_ID, NOW, makeValidInfer(), makeValidDeps(),
    );
    assert.equal(result.ok, true);
    assert.equal(result.proposal?.status, "pending_approval");
    assert.equal(result.proposal?.executable, false);
  });

  it("proposal has tier=T3", async () => {
    const result = await bridgeCouncilToFactory(
      makeCouncilPayload(), COUNCIL_ID, NOW, makeValidInfer(), makeValidDeps(),
    );
    assert.equal(result.ok, true);
    assert.equal(result.proposal?.tier, "T3");
  });

  it("proposedPayload carries specId, agentName, plan, councilGoal, councilConfidence, councilRecommendation, concreteSpec", async () => {
    const payload = makeCouncilPayload();
    const result = await bridgeCouncilToFactory(
      payload, COUNCIL_ID, NOW, makeValidInfer(), makeValidDeps(),
    );
    assert.equal(result.ok, true);
    const pp = result.proposal?.proposedPayload as Record<string, unknown>;
    assert.ok(pp, "proposedPayload must exist");
    assert.ok(typeof pp["specId"] === "string", "specId must be a string");
    assert.ok(typeof pp["agentName"] === "string", "agentName must be a string");
    assert.ok("plan" in pp, "plan key must exist in proposedPayload");
    assert.equal(pp["councilGoal"], payload.rootGoal);
    assert.equal(pp["councilConfidence"], payload.confidence);
    assert.equal(pp["councilRecommendation"], payload.recommendation);
    assert.equal(pp["councilProposalId"], COUNCIL_ID);
    // concreteSpec is new in P7
    const cs = pp["concreteSpec"] as Record<string, unknown>;
    assert.ok(cs, "concreteSpec must exist in proposedPayload");
    assert.equal(cs["agentName"], VALID_CONCRETE_SPEC.agentName);
    assert.ok(Array.isArray(cs["commands"]), "commands must be an array");
    assert.ok(Array.isArray(cs["interfaces"]), "interfaces must be an array");
  });

  it("proposal id is stable (makeFactoryProposalId of councilProposalId)", async () => {
    const result = await bridgeCouncilToFactory(
      makeCouncilPayload(), COUNCIL_ID, NOW, makeValidInfer(), makeValidDeps(),
    );
    assert.equal(result.ok, true);
    assert.equal(result.proposal?.id, makeFactoryProposalId(COUNCIL_ID));
  });

  it("proposal has sourceIntent=council-bridge:<councilProposalId>", async () => {
    const result = await bridgeCouncilToFactory(
      makeCouncilPayload(), COUNCIL_ID, NOW, makeValidInfer(), makeValidDeps(),
    );
    assert.equal(result.ok, true);
    assert.equal(result.proposal?.sourceIntent, `council-bridge:${COUNCIL_ID}`);
  });

  it("proposal has blockedReason mentioning propose-only and Hart approval", async () => {
    const result = await bridgeCouncilToFactory(
      makeCouncilPayload(), COUNCIL_ID, NOW, makeValidInfer(), makeValidDeps(),
    );
    assert.equal(result.ok, true);
    const blocked = result.proposal?.blockedReason ?? "";
    assert.ok(
      blocked.toLowerCase().includes("propose-only") || blocked.toLowerCase().includes("hart"),
      `blockedReason should mention propose-only / Hart, got: ${blocked}`,
    );
  });

  it("concretize returns null -> {ok:false}, no proposal, no throw", async () => {
    let threw = false;
    let result: BridgeResult | undefined;
    try {
      result = await bridgeCouncilToFactory(
        makeCouncilPayload(), COUNCIL_ID, NOW, makeValidInfer(), makeNullConcretizeDeps(),
      );
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "must not throw when concretize returns null");
    assert.ok(result, "must return a result");
    assert.equal(result!.ok, false);
    assert.ok(!result!.proposal, "no proposal when concretize fails");
    assert.ok(result!.reason.length > 0, "reason must be non-empty");
  });

  it("infer that returns bad JSON -> {ok:false} via null concretize", async () => {
    const result = await bridgeCouncilToFactory(
      makeCouncilPayload(), COUNCIL_ID, NOW, makeNullInfer(), {},
    );
    assert.equal(result.ok, false);
    assert.ok(!result.proposal);
  });

  it("throwing infer -> {ok:false} no throw", async () => {
    let threw = false;
    let result: BridgeResult | undefined;
    try {
      result = await bridgeCouncilToFactory(
        makeCouncilPayload(), COUNCIL_ID, NOW, makeThrowingInfer(), {},
      );
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "must not throw when infer throws");
    assert.equal(result?.ok, false);
  });

  it("compileSpecToManifest throws -> {ok:false} no throw", async () => {
    let threw = false;
    let result: BridgeResult | undefined;
    try {
      result = await bridgeCouncilToFactory(
        makeCouncilPayload(), COUNCIL_ID, NOW, makeValidInfer(), makeCompileThrowsDeps(),
      );
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "must not throw when compile throws");
    assert.equal(result?.ok, false);
    assert.ok(result?.reason.includes("compile"), `reason should mention compile: ${result?.reason}`);
  });

  it("validateManifest returns violations -> {ok:false}", async () => {
    const result = await bridgeCouncilToFactory(
      makeCouncilPayload(), COUNCIL_ID, NOW, makeValidInfer(), makeViolationDeps(),
    );
    assert.equal(result.ok, false);
    assert.ok(result.reason.toLowerCase().includes("violation"), `reason should mention violation: ${result.reason}`);
  });

  it("idempotent: same councilProposalId -> same proposal id regardless of call count", () => {
    const id1 = makeFactoryProposalId(COUNCIL_ID);
    const id2 = makeFactoryProposalId(COUNCIL_ID);
    assert.equal(id1, id2);
  });

  it("different councilProposalId -> different proposal id", () => {
    const id1 = makeFactoryProposalId("prop-council-aaa");
    const id2 = makeFactoryProposalId("prop-council-bbb");
    assert.notEqual(id1, id2);
  });

  it("proposal id starts with prop-factory-", () => {
    const id = makeFactoryProposalId(COUNCIL_ID);
    assert.ok(id.startsWith("prop-factory-"), `expected prop-factory- prefix, got: ${id}`);
  });

  it("proposal id contains no colons or dots (DB/filename safe)", () => {
    const id = makeFactoryProposalId("prop-council-2026-06-14T10:00:00.000Z");
    assert.ok(!id.includes(":") && !id.includes("."), `id must be colon/dot free: ${id}`);
  });

  it("riskLevel is high when council confidence is low", async () => {
    const payload = makeCouncilPayload({ confidence: "low" });
    const result = await bridgeCouncilToFactory(
      payload, COUNCIL_ID, NOW, makeValidInfer(), makeValidDeps(),
    );
    assert.equal(result.ok, true);
    assert.equal(result.proposal?.riskLevel, "high");
  });

  it("riskLevel is low when council confidence is high (no violations)", async () => {
    const payload = makeCouncilPayload({ confidence: "high" });
    const result = await bridgeCouncilToFactory(
      payload, COUNCIL_ID, NOW, makeValidInfer(), makeValidDeps(),
    );
    assert.equal(result.ok, true);
    assert.ok(
      ["low", "medium", "high"].includes(result.proposal?.riskLevel ?? ""),
      "riskLevel must be a valid value",
    );
  });

  it("createdAt and updatedAt match injected now", async () => {
    const result = await bridgeCouncilToFactory(
      makeCouncilPayload(), COUNCIL_ID, NOW, makeValidInfer(), makeValidDeps(),
    );
    assert.equal(result.ok, true);
    assert.equal(result.proposal?.createdAt, NOW);
    assert.equal(result.proposal?.updatedAt, NOW);
  });

  it("auditEvents has a created event", async () => {
    const result = await bridgeCouncilToFactory(
      makeCouncilPayload(), COUNCIL_ID, NOW, makeValidInfer(), makeValidDeps(),
    );
    assert.equal(result.ok, true);
    const events = result.proposal?.auditEvents ?? [];
    assert.ok(events.length >= 1, "auditEvents must be non-empty");
    assert.equal(events[0]?.event, "created");
  });

  it("requiredApproval is Hart", async () => {
    const result = await bridgeCouncilToFactory(
      makeCouncilPayload(), COUNCIL_ID, NOW, makeValidInfer(), makeValidDeps(),
    );
    assert.equal(result.ok, true);
    assert.equal(result.proposal?.requiredApproval, "Hart");
  });

  it("never throws on bizarre input (rootGoal empty string)", async () => {
    let threw = false;
    try {
      await bridgeCouncilToFactory(
        makeCouncilPayload({ rootGoal: "" }), COUNCIL_ID, NOW, makeValidInfer(), makeValidDeps(),
      );
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "must never throw even with empty rootGoal");
  });
});

// ─── Tests: buildInterrogationAnswers ─────────────────────────────────────────

describe("buildInterrogationAnswers", () => {
  it("returns answers for all 5 spec-lock dimensions + measurable_acceptance_criteria", () => {
    const answers = buildInterrogationAnswers(makeCouncilPayload(), NOW);
    const ids = answers.map((a) => a.questionId);
    assert.ok(ids.includes("read_source"), "must include read_source");
    assert.ok(ids.includes("output"), "must include output");
    assert.ok(ids.includes("proposal_type"), "must include proposal_type");
    assert.ok(ids.includes("cockpit_done"), "must include cockpit_done");
    assert.ok(ids.includes("failure_mode"), "must include failure_mode");
    assert.ok(ids.includes("measurable_acceptance_criteria"), "must include measurable_acceptance_criteria");
  });

  it("all answers have non-empty answer strings", () => {
    const answers = buildInterrogationAnswers(makeCouncilPayload(), NOW);
    for (const a of answers) {
      assert.ok(a.answer.trim().length > 0, `answer for ${a.questionId} must be non-empty`);
    }
  });

  it("all answers have answeredBy=council-bridge", () => {
    const answers = buildInterrogationAnswers(makeCouncilPayload(), NOW);
    for (const a of answers) {
      assert.equal(a.answeredBy, "council-bridge");
    }
  });

  it("answeredAt matches injected now", () => {
    const answers = buildInterrogationAnswers(makeCouncilPayload(), NOW);
    for (const a of answers) {
      assert.equal(a.answeredAt, NOW);
    }
  });

  it("includes rootGoal in read_source answer", () => {
    const payload = makeCouncilPayload();
    const answers = buildInterrogationAnswers(payload, NOW);
    const rs = answers.find((a) => a.questionId === "read_source");
    assert.ok(rs?.answer.includes(payload.rootGoal.slice(0, 30)), "read_source answer must reference rootGoal");
  });
});

// ─── Tests: runCouncilBuildBridgeOnce (disarmed) ──────────────────────────────

describe("runCouncilBuildBridgeOnce", () => {
  it("disarmed (default env) -> returns [] without touching any DB", async () => {
    const lines = await runCouncilBuildBridgeOnce({}, NOW);
    assert.ok(Array.isArray(lines), "must return array");
    assert.equal(lines.length, 0, "disarmed must return empty array");
  });

  it("flag=false -> returns []", async () => {
    const lines = await runCouncilBuildBridgeOnce(
      { HARTOS_ALLOW_COUNCIL_BUILD_BRIDGE: "false" },
      NOW,
    );
    assert.equal(lines.length, 0);
  });

  it("flag=1 (not 'true') -> returns [] (strict string comparison)", async () => {
    const lines = await runCouncilBuildBridgeOnce(
      { HARTOS_ALLOW_COUNCIL_BUILD_BRIDGE: "1" },
      NOW,
    );
    assert.equal(lines.length, 0);
  });

  it("armed but no DB URL -> returns [] (graceful no-op)", async () => {
    const lines = await runCouncilBuildBridgeOnce(
      { HARTOS_ALLOW_COUNCIL_BUILD_BRIDGE: "true" },
      NOW,
    );
    assert.ok(Array.isArray(lines), "must return array");
    assert.equal(lines.length, 0, "no DB URL -> empty array");
  });

  it("never throws regardless of env", async () => {
    let threw = false;
    try {
      await runCouncilBuildBridgeOnce(
        { HARTOS_ALLOW_COUNCIL_BUILD_BRIDGE: "invalid", HARTOS_SUPABASE_DB_URL: "invalid-url" },
        NOW,
      );
    } catch {
      threw = true;
    }
    assert.equal(threw, false, "runCouncilBuildBridgeOnce must never throw");
  });
});
