/**
 * tests/command-router.test.ts — Live Organism P3/P4: cockpit command routing + agent selection.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { routeCockpitCommand } from "../src/cockpit/command-router.js";

const r = (s: string) => routeCockpitCommand(s);

describe("routeCockpitCommand — agent selection + safety posture", () => {
  it("Wolverine audit → Wolverine/audit, gated job, NOT generic mutation rehearsal", () => {
    const d = r("Wolverine, audit the cockpit");
    assert.equal(d.selectedAgentId, "wolverine");
    assert.equal(d.selectedMode, "audit");
    assert.notEqual(d.intentClass, "mutation_action");
    assert.equal(d.needsProposal, true);
    assert.equal(d.requiresLocalRunner, true);
  });

  it("read-only Wolverine question answers directly", () => {
    const d = r("what is Wolverine seeing?");
    assert.equal(d.selectedAgentId, "wolverine");
    assert.equal(d.directAnswerPossible, true);
    assert.equal(d.needsProposal, false);
  });

  it("Beezulbub hunt → Beezulbub/hunt, requires local runner, gated (not fake execution)", () => {
    const d = r("Beezulbub hunt markdown editors");
    assert.equal(d.selectedAgentId, "beezulbub");
    assert.equal(d.selectedMode, "hunt");
    assert.equal(d.requiresLocalRunner, true);
    assert.equal(d.needsProposal, true);
    assert.match(d.fallback, /runner|job|CLI/i);
  });

  it("show capability dossiers → Beezulbub/summary, direct answer", () => {
    const d = r("show capability dossiers");
    assert.equal(d.selectedAgentId, "beezulbub");
    assert.equal(d.selectedMode, "summary");
    assert.equal(d.directAnswerPossible, true);
  });

  it("summarize the war/economy dossier → Research/summary, direct from dossier", () => {
    const d = r("summarize the war/economy dossier");
    assert.equal(d.selectedAgentId, "research");
    assert.equal(d.selectedMode, "summary");
    assert.equal(d.directAnswerPossible, true);
  });

  it("create a tax agent → Factory/create, gated proposal + approval, not mutation rehearsal", () => {
    const d = r("Factory, create a tax agent");
    assert.equal(d.selectedAgentId, "factory");
    assert.equal(d.selectedMode, "create");
    assert.notEqual(d.intentClass, "mutation_action");
    assert.equal(d.needsProposal, true);
    assert.equal(d.needsApproval, true);
  });

  it("prophet question → Prophet/forecast, read-only", () => {
    const d = r("Prophet, what will bite us next?");
    assert.equal(d.selectedAgentId, "prophet");
    assert.equal(d.selectedMode, "forecast");
    assert.equal(d.directAnswerPossible, true);
  });

  it("show me my agents → organisation, direct", () => {
    const d = r("show me my agents");
    assert.equal(d.intentClass, "organisation");
    assert.equal(d.selectedAgentId, "orchestrator");
    assert.equal(d.directAnswerPossible, true);
  });

  it("which agents are CLI-only → organisation", () => {
    assert.equal(r("which agents are CLI-only?").intentClass, "organisation");
  });

  it("bare approve/sync → mutation rehearsal (gated), no agent named", () => {
    const a = r("approve this proposal");
    assert.equal(a.intentClass, "mutation_action");
    assert.equal(a.selectedAgentId, "execution-engine");
    assert.equal(a.needsApproval, true);
    assert.equal(r("run sync now").intentClass, "mutation_action");
  });

  it("generic question → orchestrator read-only answer", () => {
    const d = r("what should I focus on today?");
    assert.equal(d.intentClass, "read_only_intelligence");
    assert.equal(d.directAnswerPossible, true);
  });

  it("unknown/unsafe → fail closed, honest fallback, no fabricated action", () => {
    const d = r("asdf qwerty zxcv");
    assert.equal(d.intentClass, "unknown");
    assert.equal(d.selectedAgentId, null);
    assert.equal(d.needsProposal, false);
    assert.equal(d.directAnswerPossible, false);
    assert.ok(d.fallback.length > 0);
  });
});
