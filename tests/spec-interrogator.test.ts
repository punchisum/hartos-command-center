/**
 * tests/spec-interrogator.test.ts — LEVEL 1, Factory Agent v1 cap 2 (plan §1 cap 2, §8).
 *
 * The PURE spec interrogator: it grills a build request BEFORE spec-lock — refuses vague /
 * generic intent, asks domain-specific required questions + a measurable-criteria question +
 * the five spec-lock dimensions, detects contradictions, and emits a spec-readiness verdict
 * that NEVER self-approves. Tests assert each gate (vague/generic refusal, partial
 * interrogation, contradiction block, DO_NOT_BUILD + high-risk block, the SPEC_READY happy
 * path) and determinism. Fully HERMETIC: no env, no network, no fs, no clock — `now` is
 * injected.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  interrogateSpec,
  detectContradictions,
  assessSpecReadiness,
  SPEC_LOCK_DIMENSIONS,
  MEASURABLE_CRITERIA_QUESTION_ID,
} from "../src/hartos/spec-interrogator.js";
import type { InterrogationAnswer } from "../src/research/agent-job-types.js";

const NOW = "2026-06-09T12:00:00.000Z";

/** A well-formed fitness request whose strategy/risk are acceptable (reaches SPEC_READY when answered). */
const FITNESS = "a fitness agent that flags clients who missed two sessions this week";
/** A finance/tax request — exercises the domain-specific finance questions. */
const TAX = "build a tax specialist agent for SG IRAS filing FY2025";
/** An ops request whose strategy risk is HIGH — must never reach SPEC_READY. */
const OPS_HIGH_RISK = "an ops agent that monitors my supabase uptime and alerts on downtime";
/** A request the strategy reviewer judges DO_NOT_BUILD — must never reach SPEC_READY. */
const DO_NOT_BUILD = "create a complex distributed orchestration platform with many integrations and providers";

/** Answer every REQUIRED interrogation item for a request (the SPEC_READY precondition). */
function answerAllRequired(request: string): InterrogationAnswer[] {
  return interrogateSpec(request)
    .questions.filter((q) => q.required)
    .map((q) => ({
      questionId: q.id,
      answer:
        q.id === MEASURABLE_CRITERIA_QUESTION_ID
          ? "flags >=95% of the target items within 60s"
          : `defined: ${q.id} answered concretely`,
      answeredBy: "Hart",
      answeredAt: NOW,
    }));
}

describe("spec interrogator (Factory Agent v1 cap 2, §1/§8)", () => {
  it("refuses a vague request (REFUSE_VAGUE) and never self-approves", () => {
    const res = assessSpecReadiness("agent", [], { now: NOW });
    assert.equal(res.readiness, "REFUSE_VAGUE");
    assert.equal(res.selfApproved, false);
    assert.equal(res.assessedAt, NOW); // injected clock, never ambient
    assert.ok(res.reason.length > 0);
  });

  it("refuses a generic 'do everything' request (REFUSE_GENERIC)", () => {
    const res = assessSpecReadiness("a general purpose agent that can do everything", [], { now: NOW });
    assert.equal(res.readiness, "REFUSE_GENERIC");
    assert.equal(res.selfApproved, false);
  });

  it("a tax/finance request emits domain-specific required questions + the measurable-criteria question + the five dimensions", () => {
    const interr = interrogateSpec(TAX);
    assert.equal(interr.domain, "tax");
    const ids = interr.questions.map((q) => q.id);
    // domain-specific finance/tax questions
    assert.ok(ids.includes("finance_jurisdiction"));
    assert.ok(ids.includes("finance_evidence_trail"));
    assert.ok(ids.includes("finance_human_approval"));
    // the always-required measurable acceptance criteria question
    assert.ok(ids.includes(MEASURABLE_CRITERIA_QUESTION_ID));
    const criteria = interr.questions.find((q) => q.id === MEASURABLE_CRITERIA_QUESTION_ID);
    assert.equal(criteria?.required, true);
    // all five spec-lock dimensions, in order, each required
    for (const d of SPEC_LOCK_DIMENSIONS) {
      const q = interr.questions.find((x) => x.id === d);
      assert.ok(q, `missing spec-lock dimension question: ${d}`);
      assert.equal(q?.required, true);
    }
    assert.deepEqual(interr.dimensionIds, SPEC_LOCK_DIMENSIONS);
    assert.equal(interr.measurableCriteriaQuestionId, MEASURABLE_CRITERIA_QUESTION_ID);
  });

  it("partial answers → NEEDS_INTERROGATION listing the still-unanswered required ids", () => {
    const partial: InterrogationAnswer[] = [
      { questionId: "read_source", answer: "supabase fitness_sessions", answeredBy: "Hart", answeredAt: NOW },
    ];
    const res = assessSpecReadiness(FITNESS, partial, { now: NOW });
    assert.equal(res.readiness, "NEEDS_INTERROGATION");
    assert.equal(res.allRequiredAnswered, false);
    // read_source is answered, so it must NOT appear in the unanswered list...
    assert.ok(!res.unansweredRequiredIds.includes("read_source"));
    // ...but the measurable-criteria question and other dimensions still must.
    assert.ok(res.unansweredRequiredIds.includes(MEASURABLE_CRITERIA_QUESTION_ID));
    assert.ok(res.unansweredRequiredIds.includes("failure_mode"));
    assert.equal(res.measurableCriteriaPresent, false);
    assert.ok(res.undefinedDimensionIds.includes("output"));
  });

  it("detects contradictions (read-only + execute · no-network + scrape · generic + measurable)", () => {
    assert.ok(
      detectContradictions("a read-only agent that will also execute and deploy changes").some((c) =>
        /read-only/i.test(c),
      ),
    );
    assert.ok(
      detectContradictions("an offline no-network agent that will scrape the web").some((c) =>
        /no-network/i.test(c),
      ),
    );
    assert.ok(
      detectContradictions("a general purpose do everything agent with a measurable 95% threshold").some((c) =>
        /generic/i.test(c),
      ),
    );
    // a clean request has none.
    assert.deepEqual(detectContradictions(FITNESS), []);
  });

  it("a contradiction blocks SPEC_READY (lands in NEEDS_RISK_REVIEW even when fully answered)", () => {
    const CONTRA = "a read-only fitness agent that will also execute and deploy changes weekly";
    const res = assessSpecReadiness(CONTRA, answerAllRequired(CONTRA), { now: NOW });
    assert.notEqual(res.readiness, "SPEC_READY");
    assert.equal(res.readiness, "NEEDS_RISK_REVIEW");
    assert.ok(res.contradictions.length > 0);
  });

  it("DO_NOT_BUILD / high-risk requests never reach SPEC_READY even when fully answered", () => {
    const dnb = assessSpecReadiness(DO_NOT_BUILD, answerAllRequired(DO_NOT_BUILD), { now: NOW });
    assert.notEqual(dnb.readiness, "SPEC_READY");
    assert.equal(dnb.readiness, "NEEDS_RISK_REVIEW");
    assert.equal(dnb.strategy.verdict, "DO_NOT_BUILD");

    const risky = assessSpecReadiness(OPS_HIGH_RISK, answerAllRequired(OPS_HIGH_RISK), { now: NOW });
    assert.notEqual(risky.readiness, "SPEC_READY");
    assert.equal(risky.readiness, "NEEDS_RISK_REVIEW");
    assert.equal(risky.strategy.risk, "high");
  });

  it("SPEC_READY only when fully satisfied — and it means 'ready for Hart', never self-approved", () => {
    const res = assessSpecReadiness(FITNESS, answerAllRequired(FITNESS), { now: NOW });
    assert.equal(res.readiness, "SPEC_READY");
    assert.equal(res.allRequiredAnswered, true);
    assert.equal(res.measurableCriteriaPresent, true);
    assert.deepEqual(res.undefinedDimensionIds, []);
    assert.deepEqual(res.contradictions, []);
    assert.notEqual(res.strategy.verdict, "DO_NOT_BUILD");
    assert.notEqual(res.strategy.risk, "high");
    // the floor: the Factory never self-approves.
    assert.equal(res.selfApproved, false);
    assert.ok(/ready for hart/i.test(res.reason));
  });

  it("is deterministic — same request + answers + now ⇒ deep-equal output", () => {
    const answers = answerAllRequired(FITNESS);
    assert.deepEqual(
      assessSpecReadiness(FITNESS, answers, { now: NOW }),
      assessSpecReadiness(FITNESS, answers, { now: NOW }),
    );
    assert.deepEqual(interrogateSpec(TAX), interrogateSpec(TAX));
    assert.deepEqual(detectContradictions(FITNESS, answers), detectContradictions(FITNESS, answers));
  });
});
