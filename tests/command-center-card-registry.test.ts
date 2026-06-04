/**
 * tests/command-center-card-registry.test.ts
 *
 * Phase 11G — card registry tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CARD_REGISTRY, getCardsByGroup, getCard, allSourcePaths } from "../src/command-center/card-registry.js";
import { CARD_GROUPS } from "../src/command-center/command-center-types.js";
import { ACTION_STATES, SAFE_STATES } from "../src/command-center/action-contract.js";

const REQUIRED_CARDS = [
  "orchestrator_latest_request",
  "orchestrator_strategy_review",
  "orchestrator_cto_review",
  "orchestrator_build_plan",
  "orchestrator_handover",
  "factory_provider_status",
  "factory_launch_status",
  "factory_bootstrap_status",
  "factory_production_promotion_status",
  "beezulbub_capability_registry",
  "beezulbub_pack_status",
  "beezulbub_provenance_health",
  "beezulbub_conflict_report",
  "beezulbub_implementation_drafts",
  "agents_inventory",
  "agents_runtime_status",
  "agents_debug_events",
  "agents_approval_queue",
  "human_manual_required",
  "human_pending_approvals",
  "human_blocked_actions",
  "human_next_recommended_command",
];

describe("command center card registry", () => {
  it("contains every required card", () => {
    for (const id of REQUIRED_CARDS) {
      assert.ok(getCard(id), `Missing required card: ${id}`);
    }
  });

  it("covers all five card groups", () => {
    for (const group of CARD_GROUPS) {
      assert.ok(getCardsByGroup(group).length > 0, `No cards for group ${group}`);
    }
  });

  it("every card has allowedActions and blockedActions", () => {
    for (const card of CARD_REGISTRY) {
      assert.ok(card.allowedActions.length > 0, `${card.id} has no allowedActions`);
      assert.ok(card.blockedActions.length > 0, `${card.id} has no blockedActions`);
    }
  });

  it("every card blocks provider mutation", () => {
    for (const card of CARD_REGISTRY) {
      assert.ok(
        card.blockedActions.includes("execute_provider_mutation"),
        `${card.id} must block execute_provider_mutation`
      );
    }
  });

  it("no card lists execute_provider_mutation as allowed", () => {
    for (const card of CARD_REGISTRY) {
      assert.ok(
        !card.allowedActions.includes("execute_provider_mutation"),
        `${card.id} must not allow execute_provider_mutation`
      );
    }
  });

  it("cards that allow gated actions are marked requiresApproval", () => {
    for (const card of CARD_REGISTRY) {
      const allowsGated = card.allowedActions.some(
        (a) => !SAFE_STATES.includes(ACTION_STATES[a])
      );
      if (allowsGated) {
        assert.equal(card.requiresApproval, true, `${card.id} allows a gated action but requiresApproval is false`);
      }
    }
  });

  it("exposes deduplicated source paths", () => {
    const paths = allSourcePaths();
    assert.equal(paths.length, new Set(paths).size);
  });
});
