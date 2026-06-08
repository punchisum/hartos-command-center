/**
 * tests/cockpit-proposal-spine.test.ts — Phase D.
 *
 * Pure spine helpers shared by the Node write store and the hosted Worker reader:
 * the read RPC name, row coercion (skips junk, never throws), and the mapping to
 * a ProposalQueueItem with honest (non-fabricated) defaults for fields the RPC
 * does not carry.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COCKPIT_PROPOSALS_RPC,
  coerceCockpitProposalRows,
  mapRowToProposalQueueItem,
  proposalToSpineRow,
  stableProposalId,
  coerceAskPersistStatus,
  type CockpitProposalRow,
} from "../src/cockpit/proposals/cockpit-proposal-spine.js";
import type { ActionProposal } from "../src/cockpit/proposals/proposal-types.js";

const NOW = "2026-06-07T00:00:00Z";

describe("cockpit proposal spine — pure helpers (Phase D)", () => {
  it("exposes the deployed read-only RPC name", () => {
    assert.equal(COCKPIT_PROPOSALS_RPC, "get_cockpit_proposals");
  });

  it("coerces well-formed rows and skips junk entries", () => {
    const rows = coerceCockpitProposalRows([
      {
        id: "p1", domain: "ops", action_type: "ops_followup_plan", title: "Chase supplier",
        risk_level: "medium", status: "pending_approval", source_intent: "ops urgent",
        spec_id: null, created_at: NOW, updated_at: NOW, expires_at: null,
      },
      null,
      { not_an_id: true },
      "garbage",
      { id: "" }, // empty id is dropped
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, "p1");
    assert.equal(rows[0]!.domain, "ops");
  });

  it("returns [] for non-array bodies (never throws)", () => {
    assert.deepEqual(coerceCockpitProposalRows(null), []);
    assert.deepEqual(coerceCockpitProposalRows(undefined), []);
    assert.deepEqual(coerceCockpitProposalRows({ rows: [] }), []);
  });

  it("maps a row to a ProposalQueueItem with honest defaults (not fabricated)", () => {
    const row: CockpitProposalRow = {
      id: "p2", domain: "fitness", action_type: "fitness_adjustment_plan", title: "Deload week",
      risk_level: "low", status: "draft", source_intent: "fitness", spec_id: "spec-x",
      created_at: NOW, updated_at: NOW, expires_at: null,
    };
    const item = mapRowToProposalQueueItem(row);
    assert.equal(item.id, "p2");
    assert.equal(item.domain, "fitness");
    assert.equal(item.actionType, "fitness_adjustment_plan");
    assert.equal(item.riskLevel, "low");
    assert.equal(item.status, "draft");
    assert.equal(item.specId, "spec-x");
    assert.equal(item.executable, false);
    assert.equal(item.requiredApproval, "Hart");
    assert.equal(item.dryRunResult, null);
    assert.deepEqual(item.auditEvents, []);
    assert.deepEqual(item.safetyNotes, []);
    assert.deepEqual(item.proposedPayload, {});
  });
});

describe("cockpit proposal spine — Ask write mapping (Phase E / Gap E)", () => {
  const draft = (over: Partial<ActionProposal> = {}): ActionProposal => ({
    id: `prop-build-a-tax-agent-${NOW}`,
    domain: "factory",
    actionType: "agent_creation_plan",
    title: "Build a Tax Agent",
    description: "",
    sourceIntent: "create a tax agent",
    proposedPayload: { target: "tax" },
    expectedEffect: "",
    riskLevel: "medium",
    requiredApproval: "Hart",
    status: "draft",
    createdAt: NOW,
    expiresAt: null,
    safetyNotes: [],
    blockedReason: "",
    dryRunResult: null,
    executable: false,
    ...over,
  });

  it("derives a content-STABLE id (no timestamp) so re-asks upsert one row", () => {
    const id = stableProposalId("factory", "agent_creation_plan", "Build a Tax Agent");
    assert.equal(id, "prop-factory-agent_creation_plan-build-a-tax-agent");
    // Same intent at two different times → same id (the in-memory draft id differs).
    const a = proposalToSpineRow(draft(), { now: "2026-06-08T01:00:00Z" });
    const b = proposalToSpineRow(draft(), { now: "2026-06-08T09:00:00Z" });
    assert.equal(a.id, b.id);
    assert.notEqual(a.id, draft().id, "stable id is NOT the timestamped in-memory id");
  });

  it("maps fields, prefers the explicit sourceIntent, and round-trips a non-executable payload", () => {
    const row = proposalToSpineRow(draft(), { now: NOW, sourceIntent: "explore a tax agent" });
    assert.equal(row.domain, "factory");
    assert.equal(row.action_type, "agent_creation_plan");
    assert.equal(row.title, "Build a Tax Agent");
    assert.equal(row.risk_level, "medium");
    assert.equal(row.status, "draft");
    assert.equal(row.source_intent, "explore a tax agent");
    assert.equal(row.created_at, NOW);
    assert.equal(row.updated_at, NOW);
    assert.equal(row.payload.executable, false);
    assert.equal(row.payload.origin, "hosted_ask");
  });

  it("CLAMPS any non-propose status to draft (nothing executable is ever persisted)", () => {
    assert.equal(coerceAskPersistStatus("draft"), "draft");
    assert.equal(coerceAskPersistStatus("pending_approval"), "pending_approval");
    assert.equal(coerceAskPersistStatus("approved_simulated"), "draft");
    assert.equal(coerceAskPersistStatus("runtime_provisioned"), "draft");
    const row = proposalToSpineRow(draft({ status: "approved_simulated" }), { now: NOW });
    assert.equal(row.status, "draft");
    assert.equal(row.payload.status, "draft");
  });
});
