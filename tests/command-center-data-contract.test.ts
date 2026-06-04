/**
 * tests/command-center-data-contract.test.ts
 *
 * Phase 11G — data contract assembly tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDataContract, ALLOWED_SOURCE_ROOTS, isAllowedSource } from "../src/command-center/data-contract.js";
import { CARD_REGISTRY } from "../src/command-center/card-registry.js";

describe("command center data contract", () => {
  it("assembles a contract with all cards and groups", () => {
    const contract = buildDataContract(new Date("2026-06-04T00:00:00Z"));
    assert.equal(contract.cardCount, CARD_REGISTRY.length);
    assert.deepEqual(contract.groups, ["orchestrator", "factory", "beezulbub", "agents", "human_control"]);
    assert.ok(contract.allowedSourceRoots.length > 0);
    assert.equal(contract.generatedAt, "2026-06-04T00:00:00.000Z");
  });

  it("only references local source roots (no URLs)", () => {
    for (const root of ALLOWED_SOURCE_ROOTS) {
      assert.ok(!/^https?:\/\//.test(root), `Source root must be local: ${root}`);
    }
  });

  it("rejects out-of-contract sources", () => {
    assert.ok(isAllowedSource("hartos-reports/foo.md"));
    assert.ok(isAllowedSource("capabilities/capability-registry.json"));
    assert.ok(isAllowedSource("packs/example/pack.manifest.json"));
    assert.ok(!isAllowedSource("https://api.openai.com"));
    assert.ok(!isAllowedSource("/etc/passwd"));
  });

  it("every card's sources are in-contract", () => {
    const contract = buildDataContract();
    for (const card of contract.cards) {
      for (const p of card.sourcePaths) {
        assert.ok(isAllowedSource(p), `Card ${card.id} source ${p} is out of contract`);
      }
    }
  });

  it("returned cards are clones (mutating one does not affect the registry)", () => {
    const contract = buildDataContract();
    contract.cards[0]!.allowedActions.push("execute_provider_mutation");
    assert.ok(!CARD_REGISTRY[0]!.allowedActions.includes("execute_provider_mutation"));
  });
});
