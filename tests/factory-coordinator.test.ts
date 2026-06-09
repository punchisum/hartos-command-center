import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  startFactoryJob,
  advanceFactoryJob,
} from "../src/hartos/factory-coordinator.js";
import type { FactoryJobState } from "../src/hartos/factory-coordinator.js";

const A = "Hart";
const AT = "2026-01-01T00:00:00.000Z";

// Answer set covering all required finance-domain questions (ids from spec-interrogator).
const FULL_ANSWERS = [
  { questionId: "finance_jurisdiction", answer: "UK HMRC; VAT invoices only", answeredBy: A, answeredAt: AT },
  { questionId: "finance_evidence_trail", answer: "Immutable append-only log per invoice row in Supabase", answeredBy: A, answeredAt: AT },
  { questionId: "finance_human_approval", answer: "Every state transition requires Hart's explicit approval", answeredBy: A, answeredAt: AT },
  { questionId: "measurable_acceptance_criteria", answer: "Surfaces 100% of overdue invoices within 5 minutes of due date", answeredBy: A, answeredAt: AT },
  { questionId: "read_source", answer: "invoices table in Supabase", answeredBy: A, answeredAt: AT },
  { questionId: "output", answer: "Overdue invoice signal card in cockpit fleet", answeredBy: A, answeredAt: AT },
  { questionId: "proposal_type", answer: "Propose-only invoice_followup_plan; strictly no execute", answeredBy: A, answeredAt: AT },
  { questionId: "cockpit_done", answer: "Fleet card shows overdue count + oldest due date", answeredBy: A, answeredAt: AT },
  { questionId: "failure_mode", answer: "Emits stale-data signal; disable via ALLOW flag", answeredBy: A, answeredAt: AT },
];

describe("factory-coordinator", () => {
  it("unsafe request is refused immediately", () => {
    const state = startFactoryJob("build an agent that auto-deploys without a gate");
    assert.equal(state.status, "refused");
    assert.ok(state.refusalReason);
    assert.ok(state.verdict?.label === "unsafe");
  });

  it("buildable request returns interrogating state with required questions", () => {
    const state = startFactoryJob(
      "build a tax invoices agent that monitors outstanding invoice payments",
      { now: "2026-01-01T00:00:00.000Z" },
    );
    assert.equal(state.status, "interrogating");
    assert.ok(state.verdict?.label === "buildable");
    assert.ok(state.interrogation);
    assert.ok((state.interrogation.interrogation.questions.length) > 0);
    assert.ok(state.interrogation.unansweredRequiredIds.length > 0);
  });

  it("interrogating + answers advances to spec_ready when all required questions answered", () => {
    const initial = startFactoryJob(
      "build a tax invoices agent that monitors outstanding invoice payments",
      { now: "2026-01-01T00:00:00.000Z" },
    );
    assert.equal(initial.status, "interrogating");

    const advanced = advanceFactoryJob(initial, { answers: FULL_ANSWERS }, { now: "2026-01-01T00:01:00.000Z" });
    assert.equal(advanced.status, "spec_ready");
    assert.ok(advanced.spec);
    assert.equal(advanced.answers?.length, FULL_ANSWERS.length);
  });

  it("spec_ready + approved advances to manifest_compiled", () => {
    const initial = startFactoryJob(
      "build a tax invoices agent that monitors outstanding invoice payments",
      { now: "2026-01-01T00:00:00.000Z" },
    );
    const specReady = advanceFactoryJob(initial, { answers: FULL_ANSWERS }, { now: "2026-01-01T00:01:00.000Z" });
    assert.equal(specReady.status, "spec_ready");

    const compiled = advanceFactoryJob(specReady, { approved: true }, { now: "2026-01-01T00:02:00.000Z" });
    assert.equal(compiled.status, "manifest_compiled");
    assert.ok(compiled.manifest);
    assert.ok(Array.isArray(compiled.violations));
  });

  it("manifest_compiled advances to planned", () => {
    const initial = startFactoryJob(
      "build a tax invoices agent that monitors outstanding invoice payments",
      { now: "2026-01-01T00:00:00.000Z" },
    );
    const specReady = advanceFactoryJob(initial, { answers: FULL_ANSWERS });
    const compiled = advanceFactoryJob(specReady, { approved: true });
    const planned = advanceFactoryJob(compiled, {});
    assert.equal(planned.status, "planned");
    assert.ok(planned.plan);
    assert.equal(planned.plan.requiresApproval, true);
  });

  it("refused is terminal — advanceFactoryJob on refused returns same state unchanged", () => {
    const refused = startFactoryJob("auto-deploy without approval automatically deploy");
    assert.equal(refused.status, "refused");

    const after = advanceFactoryJob(refused, { approved: true, answers: FULL_ANSWERS });
    assert.equal(after.status, "refused");
    assert.equal(after.jobId, refused.jobId);
    assert.equal(after.refusalReason, refused.refusalReason);
  });

  it("determinism — same inputs produce deep-equal outputs", () => {
    const request = "build a tax invoices agent that monitors outstanding invoice payments";
    const now = "2026-06-09T12:00:00.000Z";

    // startFactoryJob uses a counter internally, so both calls share counter state.
    // We call each function once and check that calling advanceFactoryJob twice on the
    // same state+input yields deep-equal results (the advance step is stateless/pure).
    const s1 = startFactoryJob(request, { now });
    const advanced1 = advanceFactoryJob(s1, { answers: FULL_ANSWERS }, { now });
    const advanced2 = advanceFactoryJob(s1, { answers: FULL_ANSWERS }, { now });
    assert.deepEqual(advanced1, advanced2);

    // Two independent startFactoryJob calls differ only in jobId (counter increments).
    // Stripping jobId: both should yield the same structure otherwise.
    const s2 = startFactoryJob(request, { now });
    const { jobId: _id1, ...rest1 } = s1;
    const { jobId: _id2, ...rest2 } = s2;
    // interrogation.assessedAt is driven by injected now — should match.
    assert.deepEqual(rest1, rest2);
  });
});
