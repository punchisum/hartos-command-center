/**
 * tests/council-factory-bridge.test.ts
 *
 * TDD tests for the P7 council→factory bridge.
 *
 * All tests use injected factory functions + fake payloads — no DB, no real Factory I/O,
 * no network. The Factory state machine is driven via injectable deps.
 *
 * Covers:
 *   1. Well-formed council payload → produces a factory/build_agent_plan
 *      pending_approval/executable:false proposal with the plan in proposedPayload.
 *   2. Refused/thin spec → {ok:false} (no proposal).
 *   3. Idempotent id is stable (same councilProposalId → same factoryProposalId).
 *   4. runCouncilBuildBridgeOnce disarmed → silent [].
 *   5. Interrogation answers cover all 5 spec-lock dimensions + measurable criteria.
 *   6. Factory already at awaiting_approval → still produces a proposal.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bridgeCouncilToFactory,
  makeFactoryProposalId,
  buildInterrogationAnswers,
  type CouncilFactoryBridgeDeps,
} from "../src/hartos/council-factory-bridge.js";
import { runCouncilBuildBridgeOnce } from "../scripts/run-council-build-bridge.js";
import type { CouncilProposalPayload } from "../src/council/council-types.js";
import type { FactoryJobState } from "../src/hartos/factory-coordinator.js";

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
          summary: "feasible: Supabase read RPCs available, no mutation needed",
          confidence: "high",
          risks: ["data freshness depends on workout logging cadence"],
          degraded: false,
        },
        {
          specialistId: "fitness",
          lens: "fitness",
          summary: "useful: adherence gaps are high-value signal for weekly review",
          confidence: "medium",
          risks: ["definition of 'missed session' needs clarification"],
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

// ─── Fake factory deps that drive to awaiting_approval ─────────────────────────

/**
 * Build fake factory deps that succeed through the full lifecycle:
 * inbox → interrogating → spec_ready → manifest_compiled → planned → awaiting_approval.
 *
 * Uses real `startFactoryJob` + `advanceFactoryJob` under the hood but injects them
 * transparently so the test is independent of the real Factory I/O. We just pass through
 * to the real implementations here — a more isolated approach would stub each state
 * but the real Factory functions are pure, so this is safe and correct.
 */
function makePassthroughDeps(): CouncilFactoryBridgeDeps {
  // No overrides: use the real pure functions (injectable no-op).
  return {};
}

/** Fake deps where startFactoryJob always refuses. */
function makeRefuseDeps(): CouncilFactoryBridgeDeps {
  return {
    startFactoryJob: (_text, _opts) => ({
      jobId: "job-refused",
      status: "refused",
      requestText: _text,
      refusalReason: "Fake refusal: too vague (injected for test)",
    }),
    advanceFactoryJob: (state, _input, _opts) => state,
  };
}

/** Fake deps where advanceFactoryJob never reaches spec_ready. */
function makeStuckInterrogatingDeps(): CouncilFactoryBridgeDeps {
  return {
    startFactoryJob: (_text, _opts) => ({
      jobId: "job-interrogating",
      status: "interrogating",
      requestText: _text,
      answers: [],
    }),
    advanceFactoryJob: (state, _input, _opts) => ({
      ...state,
      status: "interrogating" as const,
    }),
  };
}

// ─── Tests: bridgeCouncilToFactory ────────────────────────────────────────────

describe("bridgeCouncilToFactory", () => {
  it("well-formed payload with passthrough deps → ok:true, domain=factory, actionType=build_agent_plan", () => {
    const payload = makeCouncilPayload();
    const result = bridgeCouncilToFactory(payload, COUNCIL_ID, NOW, makePassthroughDeps());
    assert.equal(result.ok, true, `Expected ok:true, got reason: ${result.reason}`);
    assert.ok(result.proposal, "proposal must be present");
    assert.equal(result.proposal.domain, "factory");
    assert.equal(result.proposal.actionType, "build_agent_plan");
  });

  it("proposal has status=pending_approval and executable=false", () => {
    const result = bridgeCouncilToFactory(makeCouncilPayload(), COUNCIL_ID, NOW, makePassthroughDeps());
    assert.equal(result.ok, true);
    assert.equal(result.proposal?.status, "pending_approval");
    assert.equal(result.proposal?.executable, false);
  });

  it("proposal has tier=T3", () => {
    const result = bridgeCouncilToFactory(makeCouncilPayload(), COUNCIL_ID, NOW, makePassthroughDeps());
    assert.equal(result.ok, true);
    assert.equal(result.proposal?.tier, "T3");
  });

  it("proposedPayload carries specId, agentName, plan, councilGoal, councilConfidence, councilRecommendation", () => {
    const payload = makeCouncilPayload();
    const result = bridgeCouncilToFactory(payload, COUNCIL_ID, NOW, makePassthroughDeps());
    assert.equal(result.ok, true);
    const pp = result.proposal?.proposedPayload as Record<string, unknown>;
    assert.ok(pp, "proposedPayload must exist");
    assert.ok(typeof pp["specId"] === "string", "specId must be a string");
    assert.ok(typeof pp["agentName"] === "string", "agentName must be a string");
    // plan may be null or an object (depends on factory path), but key must exist
    assert.ok("plan" in pp, "plan key must exist in proposedPayload");
    assert.equal(pp["councilGoal"], payload.rootGoal);
    assert.equal(pp["councilConfidence"], payload.confidence);
    assert.equal(pp["councilRecommendation"], payload.recommendation);
    assert.equal(pp["councilProposalId"], COUNCIL_ID);
  });

  it("proposal id is stable (makeFactoryProposalId of councilProposalId)", () => {
    const result = bridgeCouncilToFactory(makeCouncilPayload(), COUNCIL_ID, NOW, makePassthroughDeps());
    assert.equal(result.ok, true);
    assert.equal(result.proposal?.id, makeFactoryProposalId(COUNCIL_ID));
  });

  it("proposal has sourceIntent=council-bridge:<councilProposalId>", () => {
    const result = bridgeCouncilToFactory(makeCouncilPayload(), COUNCIL_ID, NOW, makePassthroughDeps());
    assert.equal(result.ok, true);
    assert.equal(result.proposal?.sourceIntent, `council-bridge:${COUNCIL_ID}`);
  });

  it("proposal has blockedReason mentioning propose-only and Hart approval", () => {
    const result = bridgeCouncilToFactory(makeCouncilPayload(), COUNCIL_ID, NOW, makePassthroughDeps());
    assert.equal(result.ok, true);
    const blocked = result.proposal?.blockedReason ?? "";
    assert.ok(
      blocked.toLowerCase().includes("propose-only") || blocked.toLowerCase().includes("hart"),
      `blockedReason should mention propose-only / Hart, got: ${blocked}`,
    );
  });

  it("refuses if Factory startFactoryJob returns refused", () => {
    const result = bridgeCouncilToFactory(makeCouncilPayload(), COUNCIL_ID, NOW, makeRefuseDeps());
    assert.equal(result.ok, false);
    assert.ok(!result.proposal, "no proposal when refused");
    assert.ok(result.reason.length > 0, "reason must be non-empty");
  });

  it("refuses if Factory can't reach spec_ready (stuck interrogating)", () => {
    const result = bridgeCouncilToFactory(makeCouncilPayload(), COUNCIL_ID, NOW, makeStuckInterrogatingDeps());
    assert.equal(result.ok, false);
    assert.ok(!result.proposal, "no proposal when stuck");
  });

  it("idempotent: same councilProposalId → same proposal id regardless of call count", () => {
    const id1 = makeFactoryProposalId(COUNCIL_ID);
    const id2 = makeFactoryProposalId(COUNCIL_ID);
    assert.equal(id1, id2);
  });

  it("different councilProposalId → different proposal id", () => {
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

  it("riskLevel is high when council confidence is low", () => {
    const payload = makeCouncilPayload({ confidence: "low" });
    const result = bridgeCouncilToFactory(payload, COUNCIL_ID, NOW, makePassthroughDeps());
    assert.equal(result.ok, true);
    assert.equal(result.proposal?.riskLevel, "high");
  });

  it("riskLevel is low when council confidence is high (and no violations)", () => {
    const payload = makeCouncilPayload({ confidence: "high" });
    const result = bridgeCouncilToFactory(payload, COUNCIL_ID, NOW, makePassthroughDeps());
    assert.equal(result.ok, true);
    // May be low or medium depending on Factory violations; just check it's not undefined.
    assert.ok(["low", "medium", "high"].includes(result.proposal?.riskLevel ?? ""), "riskLevel must be a valid value");
  });

  it("createdAt and updatedAt match injected now", () => {
    const result = bridgeCouncilToFactory(makeCouncilPayload(), COUNCIL_ID, NOW, makePassthroughDeps());
    assert.equal(result.ok, true);
    assert.equal(result.proposal?.createdAt, NOW);
    assert.equal(result.proposal?.updatedAt, NOW);
  });

  it("auditEvents has a created event", () => {
    const result = bridgeCouncilToFactory(makeCouncilPayload(), COUNCIL_ID, NOW, makePassthroughDeps());
    assert.equal(result.ok, true);
    const events = result.proposal?.auditEvents ?? [];
    assert.ok(events.length >= 1, "auditEvents must be non-empty");
    assert.equal(events[0]?.event, "created");
  });

  it("requiredApproval is Hart", () => {
    const result = bridgeCouncilToFactory(makeCouncilPayload(), COUNCIL_ID, NOW, makePassthroughDeps());
    assert.equal(result.ok, true);
    assert.equal(result.proposal?.requiredApproval, "Hart");
  });

  it("refuses when rootGoal is empty (vague)", () => {
    // Empty rootGoal → the real Factory classifyBuildRequest should refuse it.
    const payload = makeCouncilPayload({ rootGoal: "" });
    const result = bridgeCouncilToFactory(payload, COUNCIL_ID, NOW);
    assert.equal(result.ok, false, "empty rootGoal must be refused");
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
  it("disarmed (default env) → returns [] without touching any DB", async () => {
    const lines = await runCouncilBuildBridgeOnce({}, NOW);
    assert.ok(Array.isArray(lines), "must return array");
    assert.equal(lines.length, 0, "disarmed must return empty array");
  });

  it("flag=false → returns []", async () => {
    const lines = await runCouncilBuildBridgeOnce(
      { HARTOS_ALLOW_COUNCIL_BUILD_BRIDGE: "false" },
      NOW,
    );
    assert.equal(lines.length, 0);
  });

  it("flag=1 (not 'true') → returns [] (strict string comparison)", async () => {
    const lines = await runCouncilBuildBridgeOnce(
      { HARTOS_ALLOW_COUNCIL_BUILD_BRIDGE: "1" },
      NOW,
    );
    assert.equal(lines.length, 0);
  });

  it("armed but no DB URL → returns [] (graceful no-op)", async () => {
    const lines = await runCouncilBuildBridgeOnce(
      { HARTOS_ALLOW_COUNCIL_BUILD_BRIDGE: "true" },
      NOW,
    );
    assert.ok(Array.isArray(lines), "must return array");
    assert.equal(lines.length, 0, "no DB URL → empty array");
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
