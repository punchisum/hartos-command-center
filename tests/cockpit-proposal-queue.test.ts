/**
 * tests/cockpit-proposal-queue.test.ts
 *
 * Phase 14B — local proposal queue. Covers save/list/read/reject/dry-run/expire/
 * mark-simulated-approved/audit, ref resolution, fail-closed execution, and the
 * no-secrets guarantee. All local; nothing executes.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  saveProposal,
  listProposals,
  readProposal,
  resolveRef,
  rejectProposal,
  markSimulatedApproved,
  approveForExecution,
  markExecuted,
  expireStaleProposals,
  dryRunProposalInQueue,
  appendAudit,
  DEFAULT_PROPOSAL_QUEUE_DIR,
  generateProposals,
  executeProposal,
  ActionExecutionDisabledError,
  rejectAllDraftProposals,
  expireDuplicateProposals,
  proposalHistory,
  type ProposalContext,
  type ActionProposal,
} from "../src/cockpit/proposals/index.js";
import { buildDomainPanels, DEFAULT_MODULES, type PanelInputs } from "../src/cockpit/panels/index.js";
import type { AgentIntegrationSummary } from "../src/agents/agent-types.js";
import type { ReadModelRegistrySummary } from "../src/read-models/read-model-types.js";

const NOW = "2026-06-04T12:00:00.000Z";

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

describe("markExecuted — executor-only terminal transition (Phase 1)", () => {
  it("advances approved_for_execution → executed; denies any other status", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "queue-exec-"));
    try {
      const p = makeProposal("2026-06-04T09:00:00.000Z");
      const saved = await saveProposal(dir, p, "2026-06-04T09:00:00.000Z");
      // draft → simulated_approved → approved_for_execution
      await markSimulatedApproved(dir, { id: saved!.id }, NOW);
      const approved = await approveForExecution(dir, { id: saved!.id }, NOW);
      assert.equal(approved!.status, "approved_for_execution");
      // executor advances to executed
      const executed = await markExecuted(dir, { id: saved!.id }, NOW, "dispatched clickup-move-status");
      assert.equal(executed!.status, "executed");
      assert.ok(executed!.auditEvents.some((e) => e.event === "executed"));
      // a second call (now status=executed) is denied, leaving it unchanged
      const again = await markExecuted(dir, { id: saved!.id }, NOW);
      assert.equal(again!.status, "executed");
      assert.ok(again!.auditEvents.some((e) => e.event === "executed_denied"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("proposal queue storage", () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "queue-")); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("saves a draft to the gitignored cockpit-proposals dir", async () => {
    const p = makeProposal("2026-06-04T10:00:00.000Z");
    const item = await saveProposal(dir, p, "2026-06-04T10:00:00.000Z");
    assert.ok(item);
    assert.equal(item!.status, "draft");
    assert.equal(item!.auditEvents[0]!.event, "created");
    assert.ok(existsSync(path.join(dir, DEFAULT_PROPOSAL_QUEUE_DIR)));
    const files = await readdir(path.join(dir, DEFAULT_PROPOSAL_QUEUE_DIR));
    assert.ok(files.length >= 1);
  });

  it("lists newest first and resolves by number or id", async () => {
    await saveProposal(dir, makeProposal("2026-06-04T11:00:00.000Z"), "2026-06-04T11:00:00.000Z");
    const list = await listProposals(dir);
    assert.ok(list.length >= 2);
    assert.ok(list[0]!.createdAt >= list[1]!.createdAt);
    const byNum = await resolveRef(dir, { number: 1 });
    assert.equal(byNum!.id, list[0]!.id);
    const byId = await resolveRef(dir, { id: list[0]!.id });
    assert.equal(byId!.id, list[0]!.id);
    assert.equal(await resolveRef(dir, { number: 999 }), null);
  });

  it("rejects locally and appends an audit event", async () => {
    const updated = await rejectProposal(dir, { number: 1 }, NOW);
    assert.equal(updated!.status, "rejected");
    assert.ok(updated!.auditEvents.some((e) => e.event === "rejected"));
    const reread = await readProposal(dir, updated!.id);
    assert.equal(reread!.status, "rejected");
  });

  it("dry-runs a stored proposal without executing", async () => {
    const updated = await dryRunProposalInQueue(dir, { number: 2 }, NOW, {});
    assert.ok(updated!.dryRunResult);
    assert.equal(updated!.dryRunResult!.executed, false);
    assert.ok(updated!.auditEvents.some((e) => e.event === "dry_run"));
  });

  it("marks simulated-approved (never executed)", async () => {
    const updated = await markSimulatedApproved(dir, { number: 2 }, NOW);
    assert.equal(updated!.status, "simulated_approved");
  });

  it("appends a custom audit event", async () => {
    const updated = await appendAudit(dir, { number: 2 }, "inspected", NOW, "by test");
    assert.ok(updated!.auditEvents.some((e) => e.event === "inspected" && e.detail === "by test"));
  });

  it("expires stale proposals", async () => {
    const dir2 = await mkdtemp(path.join(tmpdir(), "queue-exp-"));
    const p = makeProposal("2026-06-01T00:00:00.000Z");
    p.expiresAt = "2026-06-02T00:00:00.000Z"; // already past relative to NOW
    await saveProposal(dir2, p, "2026-06-01T00:00:00.000Z");
    const count = await expireStaleProposals(dir2, NOW);
    assert.equal(count, 1);
    const list = await listProposals(dir2);
    assert.equal(list[0]!.status, "expired");
    await rm(dir2, { recursive: true, force: true });
  });

  it("no secret-looking values in stored files", async () => {
    for (const f of await readdir(path.join(dir, DEFAULT_PROPOSAL_QUEUE_DIR))) {
      const content = await readFile(path.join(dir, DEFAULT_PROPOSAL_QUEUE_DIR, f), "utf8");
      assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(content));
      assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(content));
    }
  });

  it("missing storage degrades gracefully (list = [])", async () => {
    assert.deepEqual(await listProposals(path.join(dir, "does-not-exist")), []);
  });

  it("execution remains impossible (fail closed)", () => {
    assert.throws(() => executeProposal(), ActionExecutionDisabledError);
  });
});

// ── Phase 14B cleanup — bulk reject / expire duplicates / history ──
function fake(domain: ActionProposal["domain"], title: string, actionType: ActionProposal["actionType"], createdAt: string): ActionProposal {
  return {
    id: `prop-${domain}-${title}-${createdAt}`.replace(/[^a-zA-Z0-9._-]/g, "-"),
    domain, actionType, title,
    description: "d", sourceIntent: "x", proposedPayload: {}, expectedEffect: "e",
    riskLevel: "low", requiredApproval: "Hart", status: "draft", createdAt, expiresAt: null,
    safetyNotes: [], blockedReason: "execution disabled", dryRunResult: null, executable: false,
  };
}

describe("proposal queue cleanup (Phase 14B)", () => {
  it("rejects all draft/pending fitness proposals, leaving other domains untouched", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "queue-rj-"));
    await saveProposal(dir, fake("fitness", "Fitness adjustment", "fitness_adjustment_plan", "2026-06-04T10:00:00.000Z"), NOW);
    await saveProposal(dir, fake("fitness", "Fitness adjustment 2", "fitness_adjustment_plan", "2026-06-04T11:00:00.000Z"), NOW);
    await saveProposal(dir, fake("ops", "Ops follow-up", "ops_followup_plan", "2026-06-04T12:00:00.000Z"), NOW);
    const res = await rejectAllDraftProposals(dir, NOW, "fitness");
    assert.equal(res.count, 2);
    const list = await listProposals(dir);
    assert.equal(list.filter((p) => p.domain === "fitness").every((p) => p.status === "rejected"), true);
    assert.equal(list.find((p) => p.domain === "ops")!.status, "draft");
    assert.ok(list.find((p) => p.domain === "fitness")!.auditEvents.some((e) => e.event === "rejected"));
    await rm(dir, { recursive: true, force: true });
  });

  it("expires older duplicates, keeping the newest active proposal", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "queue-dup-"));
    await saveProposal(dir, fake("fitness", "Same plan", "fitness_adjustment_plan", "2026-06-04T10:00:00.000Z"), NOW);
    await saveProposal(dir, fake("fitness", "Same plan", "fitness_adjustment_plan", "2026-06-04T12:00:00.000Z"), NOW);
    await saveProposal(dir, fake("ops", "Different", "ops_followup_plan", "2026-06-04T11:00:00.000Z"), NOW);
    const res = await expireDuplicateProposals(dir, NOW);
    assert.equal(res.count, 1);
    const list = await listProposals(dir);
    const same = list.filter((p) => p.title === "Same plan");
    assert.equal(same.filter((p) => p.status === "draft").length, 1);
    assert.equal(same.filter((p) => p.status === "expired").length, 1);
    // newest kept active
    assert.equal(same.find((p) => p.status === "draft")!.createdAt, "2026-06-04T12:00:00.000Z");
    assert.equal(list.find((p) => p.domain === "ops")!.status, "draft");
    await rm(dir, { recursive: true, force: true });
  });

  it("history reports pending/rejected/simulated/expired counts (read-only)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "queue-hist-"));
    await saveProposal(dir, fake("fitness", "A", "fitness_adjustment_plan", "2026-06-04T10:00:00.000Z"), NOW);
    await saveProposal(dir, fake("ops", "B", "ops_followup_plan", "2026-06-04T11:00:00.000Z"), NOW);
    await rejectProposal(dir, { number: 1 }, NOW); // rejects the ops one (newest first)
    const h = await proposalHistory(dir);
    assert.equal(h.total, 2);
    assert.equal(h.rejected, 1);
    assert.equal(h.pending, 1);
    assert.equal(h.active, 1);
    assert.ok(h.latestActive.length <= 5);
    await rm(dir, { recursive: true, force: true });
  });

  it("cleanup ops never execute and degrade on absent storage", async () => {
    const empty = path.join(tmpdir(), "queue-none-xyz");
    assert.equal((await rejectAllDraftProposals(empty, NOW, "fitness")).count, 0);
    assert.equal((await expireDuplicateProposals(empty, NOW)).count, 0);
    assert.equal((await proposalHistory(empty)).total, 0);
    assert.throws(() => executeProposal(), ActionExecutionDisabledError);
  });
});
