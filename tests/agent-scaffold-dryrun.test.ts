/**
 * tests/agent-scaffold-dryrun.test.ts
 *
 * Phase 17D — local scaffold dry-run from an approved plan. Proves: artifacts are produced LOCALLY,
 * the provider plan is reported with all mutations blocked (gates closed), nothing is executed, the
 * proposal is not advanced, artifacts carry no secrets, and the dry-run refuses unless the proposal
 * is explicitly authorized (Key 1). No provider mutation, no push, no deploy.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  saveProposal,
  markSimulatedApproved,
  approveForExecution,
  readProposal,
  generateProposals,
  type ProposalContext,
} from "../src/cockpit/proposals/index.js";
import { runLocalScaffoldDryRun, DryRunPreconditionError } from "../src/execution/index.js";
import { containsSecret } from "../src/llm/redaction.js";
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

/** Save → simulate → authorize, returning the proposal id. */
async function authorizedProposal(dir: string): Promise<string> {
  const p = makeProposal(NOW);
  await saveProposal(dir, p, NOW);
  await markSimulatedApproved(dir, { id: p.id }, NOW);
  await approveForExecution(dir, { id: p.id }, NOW);
  return p.id;
}

describe("17D — local scaffold dry-run", () => {
  let dir: string;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "dryrun-")); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  it("produces local artifacts with all provider mutations blocked, nothing executed", async () => {
    const id = await authorizedProposal(dir);
    const result = await runLocalScaffoldDryRun({ cwd: dir, ref: { id }, now: NOW, env: {} });

    assert.equal(result.executed, false);
    assert.equal(result.secretsClean, true);
    assert.equal(result.proposalUnchanged, true);
    assert.ok(result.specId.startsWith("spec-"));

    // Core artifacts + provider-specific drafts (tax agent → github/supabase/cloudflare/openai).
    const rels = result.artifacts.map((a) => a.relPath);
    for (const expected of [
      "agent-spec-draft.json",
      "STRUCTURE.md",
      ".env.example",
      "provider-plan.md",
      "CHECKLIST.md",
      "supabase/migrations/0001_DRAFT_schema.sql",
      "wrangler.cockpit.toml.example",
    ]) {
      assert.ok(rels.includes(expected), `expected artifact ${expected}`);
      assert.ok(existsSync(path.join(result.outDir, expected)), `${expected} must exist on disk`);
    }

    // Provider dry-run: there ARE mutating steps and ALL are blocked (gates closed).
    assert.ok(result.providerDryRun.mutatingSteps > 0);
    assert.equal(result.providerDryRun.allMutationsBlocked, true);
    assert.ok(result.providerDryRun.steps.every((s) => !s.mutation || s.outcome === "blocked_gate_closed"));
  });

  it("spec draft is plan-level and explicitly NOT the Factory AgentConfig", async () => {
    const id = await authorizedProposal(dir);
    const result = await runLocalScaffoldDryRun({ cwd: dir, ref: { id }, now: NOW, env: {} });
    const spec = JSON.parse(await readFile(path.join(result.outDir, "agent-spec-draft.json"), "utf8"));
    assert.equal(spec.kind, "agent-creation-spec-draft");
    assert.equal(spec.specId, result.specId);
    assert.equal(spec.sourceProposalId, id);
    assert.match(spec.note, /NOT that artifact|Agent Factory/i);
  });

  it("writes no secrets into any artifact", async () => {
    const id = await authorizedProposal(dir);
    const result = await runLocalScaffoldDryRun({ cwd: dir, ref: { id }, now: NOW, env: {} });
    for (const a of result.artifacts) {
      const content = await readFile(path.join(result.outDir, a.relPath), "utf8");
      assert.equal(containsSecret(content), false, `${a.relPath} must contain no secrets`);
    }
  });

  it("records an audit event WITHOUT advancing the proposal (stays approved_for_execution)", async () => {
    const id = await authorizedProposal(dir);
    await runLocalScaffoldDryRun({ cwd: dir, ref: { id }, now: NOW, env: {} });
    const item = await readProposal(dir, id);
    assert.equal(item!.status, "approved_for_execution");
    assert.ok(item!.auditEvents.some((e) => e.event === "local_scaffold_dryrun"));
  });

  it("refuses to run unless the proposal is approved_for_execution (Key 1)", async () => {
    const p = makeProposal(NOW);
    await saveProposal(dir, p, NOW);
    await markSimulatedApproved(dir, { id: p.id }, NOW); // simulated, but NOT authorized
    await assert.rejects(
      () => runLocalScaffoldDryRun({ cwd: dir, ref: { id: p.id }, now: NOW, env: {} }),
      DryRunPreconditionError
    );
  });

  it("never executes even when host gates are OPEN (17D is dry-run regardless)", async () => {
    const id = await authorizedProposal(dir);
    // Open EVERY provider gate the default adapter set could require — proving that even with all
    // gates open, 17D still does not run a single mutating step (it is dry-run by construction).
    const openGates = {
      ALLOW_AUTO_PROVISION: "true",
      ALLOW_GITHUB_PROVISION: "true",
      ALLOW_GITHUB_PUSH: "true",
      ALLOW_SUPABASE_PROJECT_CREATE: "true",
      ALLOW_SUPABASE_MIGRATION_APPLY: "true",
      ALLOW_CLOUDFLARE_SECRET_UPLOAD: "true",
      ALLOW_CLOUDFLARE_DEPLOY: "true",
      ALLOW_TRIGGER_TASK_REGISTER: "true",
      ALLOW_TELEGRAM_WEBHOOK_REGISTER: "true",
      ALLOW_TELEGRAM_TEST_SEND: "true",
    };
    const result = await runLocalScaffoldDryRun({ cwd: dir, ref: { id }, now: NOW, env: openGates });
    assert.equal(result.executed, false, "17D must not execute even with gates open");
    // With gates open, mutating steps are reported as 'gate_open_not_run' — still NOT run.
    const mutating = result.providerDryRun.steps.filter((s) => s.mutation);
    assert.ok(mutating.length > 0);
    assert.ok(mutating.every((s) => s.outcome === "gate_open_not_run"));
  });
});
