/**
 * tests/agent-creation-execution-lifecycle.test.ts
 *
 * Phase 17C/17D — two-key execution authorization lifecycle on the proposal queue.
 * Covers approveForExecution (Key 1), explicit revoke (no auto-expiry), durable spec id,
 * authorization age, the executor-only-status guard, and that execution still fails closed.
 * All local; nothing executes.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  saveProposal,
  markSimulatedApproved,
  approveForExecution,
  revokeExecutionApproval,
  executionAuthorizationAgeMs,
  assertCockpitSettableStatus,
  deriveSpecId,
  generateProposals,
  executeProposal,
  ActionExecutionDisabledError,
  type ProposalContext,
} from "../src/cockpit/proposals/index.js";
import { buildDomainPanels, DEFAULT_MODULES, type PanelInputs } from "../src/cockpit/panels/index.js";
import type { AgentIntegrationSummary } from "../src/agents/agent-types.js";
import type { ReadModelRegistrySummary } from "../src/read-models/read-model-types.js";

const NOW = "2026-06-05T12:00:00.000Z";

function panels(): ReturnType<typeof buildDomainPanels> {
  const agentIntegration: AgentIntegrationSummary = { generatedAt: "t", configPresent: true, configPath: "x", configuredAgents: 0, detectedAgents: 0, agents: [], missingSources: [], nextRecommendedCommand: "x" };
  const readModels: ReadModelRegistrySummary = { generatedAt: "t", configPresent: false, configPath: null, configuredReadModels: 0, enabledReadModels: 0, availability: [], summaries: [], missingEnv: [], nextRecommendedCommand: "x" };
  const inputs: PanelInputs = { agentIntegration, readModels, reports: [], capability: { present: false, count: 0, byStatus: {}, names: [] }, modules: DEFAULT_MODULES, now: NOW };
  return buildDomainPanels(inputs);
}

function makeProposal(now: string) {
  const ctx: ProposalContext = { request: "Create a tax agent", intent: "build_agent", panels: panels(), now, env: {} };
  return generateProposals(ctx)[0]!;
}

describe("17C/17D — execution authorization lifecycle", () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "exec-lifecycle-")); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("approveForExecution requires simulated_approved, assigns a durable spec id + age, audits", async () => {
    const p = makeProposal(NOW);
    await saveProposal(dir, p, NOW);

    // From draft, authorization is DENIED (status unchanged), with a denied audit event.
    const denied = await approveForExecution(dir, { id: p.id }, NOW);
    assert.equal(denied!.status, "draft");
    assert.ok(denied!.auditEvents.some((e) => e.event === "approve_for_execution_denied"));
    assert.ok(!denied!.specId);

    // Simulate first, then authorize.
    await markSimulatedApproved(dir, { id: p.id }, NOW);
    const authorized = await approveForExecution(dir, { id: p.id }, NOW);
    assert.equal(authorized!.status, "approved_for_execution");
    assert.equal(authorized!.specId, deriveSpecId(authorized!));
    assert.ok(authorized!.specId!.startsWith("spec-"));
    assert.notEqual(authorized!.specId, authorized!.id, "spec id must be distinct from the proposal id");
    assert.equal(authorized!.executionAuthorizedAt, NOW);
    assert.ok(authorized!.auditEvents.some((e) => e.event === "approved_for_execution"));

    // Age is reported (no auto-expiry — staleness must be visible).
    const later = "2026-06-05T13:00:00.000Z";
    assert.equal(executionAuthorizationAgeMs(authorized!, later), 60 * 60 * 1000);
  });

  it("explicit revoke returns to simulated_approved, keeps the durable spec id, clears age", async () => {
    const p = makeProposal(NOW);
    await saveProposal(dir, p, NOW);
    await markSimulatedApproved(dir, { id: p.id }, NOW);
    const authorized = await approveForExecution(dir, { id: p.id }, NOW);
    const specId = authorized!.specId;

    const revoked = await revokeExecutionApproval(dir, { id: p.id }, NOW);
    assert.equal(revoked!.status, "simulated_approved");
    assert.equal(revoked!.executionAuthorizedAt, null);
    assert.equal(revoked!.specId, specId, "spec id is durable — survives revoke");
    assert.equal(executionAuthorizationAgeMs(revoked!, NOW), null);
    assert.ok(revoked!.auditEvents.some((e) => e.event === "execution_authorization_revoked"));

    // Revoking when not authorized is denied.
    const reRevoke = await revokeExecutionApproval(dir, { id: p.id }, NOW);
    assert.equal(reRevoke!.status, "simulated_approved");
    assert.ok(reRevoke!.auditEvents.some((e) => e.event === "revoke_execution_denied"));
  });

  it("guards executor-only statuses against cockpit-side writes", () => {
    for (const s of ["executing", "executed", "execution_failed"] as const) {
      assert.throws(() => assertCockpitSettableStatus(s), /only by the Node execution host/);
    }
    for (const s of ["draft", "pending_approval", "simulated_approved", "approved_for_execution", "rejected", "expired"] as const) {
      assert.doesNotThrow(() => assertCockpitSettableStatus(s));
    }
  });

  it("real execution still fails closed", () => {
    assert.throws(() => executeProposal(), ActionExecutionDisabledError);
  });
});
