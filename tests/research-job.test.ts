/**
 * tests/research-job.test.ts — Slice G (3-levels-up master plan §7/§8).
 *
 * The PURE research job lifecycle planner: it turns a request into the universal
 * `AgentJob` + a non-executable Research Job Proposal, composing the F1 `planResearch`
 * with the wave-1 AgentJob / BoundaryDefinition canon. Tests assert the §7 gate
 * (ready ⇒ proposed; broad/thin ⇒ not proposed), the FAIL-CLOSED boundary (fed to the
 * real `checkBoundary`), the proposal contract (research / research_plan / executable
 * false), and determinism. Fully HERMETIC: no env, no network, no fs, no clock — `now`
 * is injected.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildResearchJob, proposeResearchJob } from "../src/research/research-job.js";
import { checkBoundary, type BoundaryUsage } from "../src/research/boundary-gate.js";

const NOW = "2026-06-09T12:00:00.000Z";
const READY = "research virtual card issuer options for media buying";

describe("research job lifecycle planner (Slice G, §7/§8)", () => {
  it("a ready request yields an AgentJob with status 'proposed'", () => {
    const job = buildResearchJob(READY, { now: NOW });
    assert.equal(job.status, "proposed");
    assert.equal(job.agentType, "research");
    assert.equal(job.jobType, "research");
    assert.equal(job.createdAt, NOW); // injected clock, never ambient
    assert.equal(job.confidence, "unknown");
    assert.equal(job.completedAt, null);
  });

  it("emits §8 interrogation questions and a locked scope (no interrogation/scope = no job)", () => {
    const job = buildResearchJob(READY, { now: NOW });
    assert.ok(job.interrogationQuestions.length >= 4);
    // §8: it must ask what decision + which geography/localization first.
    const ids = job.interrogationQuestions.map((q) => q.id);
    assert.ok(ids.includes("decision"));
    assert.ok(ids.includes("geography"));
    assert.ok(job.interrogationQuestions.some((q) => q.required));
    assert.ok(job.scope.statement.length > 0);
    assert.ok(job.scope.inScope.length > 0);
    assert.equal(job.decisionSupported, job.scope.decisionSupported);
    // anti-fabrication: no findings, only honest unknowns + a seed audit entry.
    assert.equal(job.mainFindings.length, 0);
    assert.ok(job.unknowns.length > 0);
    assert.equal(job.auditTrail.length, 1);
    assert.equal(job.auditTrail[0]?.at, NOW);
  });

  it("the produced BoundaryDefinition is FAIL-CLOSED — checkBoundary denies network + LLM", () => {
    const job = buildResearchJob(READY, { now: NOW });
    const b = job.boundaryDefinition;
    // network + LLM are deliberately left undefined ⇒ the gate must deny them by default.
    assert.equal(b.externalNetworkAllowed, undefined);
    assert.equal(b.llmAllowed, undefined);
    assert.ok(b.stopConditions.length > 0);
    assert.equal(typeof b.maxFilesWritten, "number");
    assert.ok(b.targetFolder && b.targetFolder.length > 0);

    const usage: BoundaryUsage = { usesExternalNetwork: true, usesLlm: true };
    const result = checkBoundary(usage, b);
    assert.equal(result.allowed, false);
    assert.ok(result.denials.some((d) => /external network not permitted/i.test(d)));
    assert.ok(result.denials.some((d) => /LLM use not permitted/i.test(d)));

    // and writing more files than the ceiling is also refused.
    const tooMany = checkBoundary({ filesWritten: (b.maxFilesWritten ?? 0) + 1 }, b);
    assert.equal(tooMany.allowed, false);
    assert.ok(tooMany.denials.some((d) => /maxFilesWritten exceeded/i.test(d)));

    // a benign, in-bounds usage passes (proves the gate isn't refusing everything).
    const ok = checkBoundary({ filesWritten: 1 }, b);
    assert.equal(ok.allowed, true);
    assert.deepEqual(ok.denials, []);
  });

  it("proposeResearchJob returns a non-executable Research Job Proposal (research / research_plan)", () => {
    const { job, proposal } = proposeResearchJob(READY, { now: NOW });
    assert.equal(proposal.domain, "research");
    assert.equal(proposal.actionType, "research_plan");
    assert.equal(proposal.executable, false);
    assert.equal(proposal.requiredApproval, "Hart");
    assert.equal(proposal.status, "draft"); // default lifecycle, never executor-only
    assert.equal(proposal.dryRunResult, null);
    assert.equal(proposal.createdAt, NOW);
    assert.ok(proposal.blockedReason.length > 0);
    // the proposal references its job and never fabricates findings.
    assert.equal(proposal.proposedPayload.jobId, job.jobId);
    assert.equal(proposal.proposedPayload.jobStatus, job.status);
  });

  it("the proposal status comes from opts (still never executor-only)", () => {
    const { proposal } = proposeResearchJob(READY, { now: NOW, proposalStatus: "pending_approval" });
    assert.equal(proposal.status, "pending_approval");
  });

  it("§7 gate: an over-broad request does NOT yield 'proposed'", () => {
    const broad = buildResearchJob("research everything about distributed systems", { now: NOW });
    assert.notEqual(broad.status, "proposed");
    assert.equal(broad.status, "requested");
    // a thin / under-scoped request also stays out of 'proposed'.
    const thin = buildResearchJob("research", { now: NOW });
    assert.notEqual(thin.status, "proposed");
    assert.equal(thin.status, "interrogating");
  });

  it("§7 gate: supplied-but-incomplete required interrogation keeps the job 'interrogating'", () => {
    const partial = buildResearchJob(READY, {
      now: NOW,
      answers: [{ questionId: "decision", answer: "pick a card issuer", answeredBy: "Hart", answeredAt: NOW }],
    });
    // 'decision' is answered but other required items (geography/depth/sources) are not.
    assert.equal(partial.status, "interrogating");
    assert.equal(partial.answers.length, 1);
  });

  it("is deterministic — same request + same now ⇒ deep-equal job and proposal", () => {
    assert.deepEqual(buildResearchJob(READY, { now: NOW }), buildResearchJob(READY, { now: NOW }));
    assert.deepEqual(proposeResearchJob(READY, { now: NOW }), proposeResearchJob(READY, { now: NOW }));
  });
});
