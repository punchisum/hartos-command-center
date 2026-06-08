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
  type CockpitProposalRow,
} from "../src/cockpit/proposals/cockpit-proposal-spine.js";

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
