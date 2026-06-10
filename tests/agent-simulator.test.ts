/**
 * tests/agent-simulator.test.ts — the Factory Replay/Simulator.
 *
 * Replays scenarios through the agent's real boundary gate and asserts PASS/FAIL behavior.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { simulateAgent, deriveScenariosFromManifest, type SimScenario } from "../src/hartos/agent-simulator.js";
import type { AgentManifest } from "../src/hartos/manifest-types.js";

/** Minimal manifest covering only the fields the simulator reads. */
function manifest(over: Record<string, unknown> = {}): AgentManifest {
  return {
    contract: { type: "invoices", readModelId: "invoices", proposalTypes: ["invoice_followup_plan"] },
    readModel: { type: "invoices" },
    jobLifecycle: {
      boundary: {
        maxSearchDepth: 3,
        disallowedSources: ["scrape-the-web"],
        externalNetworkAllowed: false,
        llmAllowed: false,
        stopConditions: ["stop at 20 sources"],
      },
      jobType: "monitoring",
      stages: [],
    },
    ...over,
  } as unknown as AgentManifest;
}

describe("deriveScenariosFromManifest", () => {
  it("derives a happy path plus red-team cases for each denied capability", () => {
    const s = deriveScenariosFromManifest(manifest());
    const ids = s.map((x) => x.id);
    assert.ok(ids.includes("happy-path"));
    assert.ok(ids.includes("red-team-network"));
    assert.ok(ids.includes("red-team-llm"));
    assert.ok(ids.includes("red-team-denied-source"));
    assert.ok(ids.includes("red-team-depth"));
  });

  it("omits red-team cases for capabilities the boundary explicitly allows", () => {
    const s = deriveScenariosFromManifest(
      manifest({
        jobLifecycle: { boundary: { externalNetworkAllowed: true, llmAllowed: true, stopConditions: [] }, jobType: "research", stages: [] },
      }),
    );
    const ids = s.map((x) => x.id);
    assert.ok(!ids.includes("red-team-network"));
    assert.ok(!ids.includes("red-team-llm"));
  });
});

describe("simulateAgent", () => {
  it("PASSes a well-bounded, propose-only agent on its derived scenarios", () => {
    const r = simulateAgent(manifest());
    assert.equal(r.verdict, "PASS");
    assert.equal(r.passed, r.total);
    assert.equal(r.boundaryBites, true); // red-team cases were refused
  });

  it("FAILs when the boundary does NOT bite work it should refuse", () => {
    // A boundary that allows everything — red-team network/LLM cases will be (wrongly) allowed.
    const r = simulateAgent(
      manifest(),
      [
        { id: "rt-net", description: "reach network", usage: { usesExternalNetwork: true }, expectRefused: true } as SimScenario,
      ],
    );
    // The manifest's boundary denies network, so this red-team IS refused → ok.
    assert.equal(r.verdict, "PASS");

    // Now an agent whose boundary allows the network but a scenario expects refusal → FAIL.
    const open = manifest({
      jobLifecycle: { boundary: { externalNetworkAllowed: true, stopConditions: [] }, jobType: "research", stages: [] },
    });
    const r2 = simulateAgent(open, [
      { id: "rt-net", description: "reach network", usage: { usesExternalNetwork: true }, expectRefused: true } as SimScenario,
    ]);
    assert.equal(r2.verdict, "FAIL");
    assert.ok(r2.scenarios[0].notes.some((n) => n.includes("does not bite")));
  });

  it("FAILs the happy path when the proposal vocabulary does not cover the work", () => {
    const r = simulateAgent(manifest(), [
      { id: "hp", description: "core work", usage: { searchDepth: 1 }, expectedProposalType: "not_a_real_type", expectRefused: false },
    ]);
    assert.equal(r.verdict, "FAIL");
    assert.ok(r.scenarios[0].notes.some((n) => n.includes("not in the agent's vocabulary")));
  });

  it("FAILs the happy path when the boundary refuses core work", () => {
    const r = simulateAgent(manifest(), [
      { id: "hp", description: "core work that over-recurses", usage: { searchDepth: 99 }, expectRefused: false },
    ]);
    assert.equal(r.verdict, "FAIL");
    assert.ok(r.scenarios[0].notes.some((n) => n.includes("refused core work")));
  });

  it("FAILs on manifest invariants: no proposal vocabulary", () => {
    const r = simulateAgent(manifest({ contract: { type: "x", readModelId: "x", proposalTypes: [] } }));
    assert.equal(r.verdict, "FAIL");
    assert.ok(r.invariantNotes.some((n) => n.includes("no propose-only proposal vocabulary")));
  });

  it("FAILs on manifest invariants: no read-model", () => {
    const r = simulateAgent(manifest({ readModel: {} }));
    assert.equal(r.verdict, "FAIL");
    assert.ok(r.invariantNotes.some((n) => n.includes("no read-model")));
  });

  it("FAILs on an empty boundary (no boundaries = no job)", () => {
    const r = simulateAgent(manifest({ jobLifecycle: { boundary: { stopConditions: [] }, jobType: "other", stages: [] } }));
    assert.equal(r.verdict, "FAIL");
    assert.ok(r.invariantNotes.some((n) => n.includes("empty boundary")));
  });

  it("FAILs with an explicit zero scenarios (a simulation that proves nothing)", () => {
    const r = simulateAgent(manifest(), []);
    assert.equal(r.total, 0);
    assert.equal(r.verdict, "FAIL");
    assert.ok(r.invariantNotes.some((n) => n.includes("zero scenarios")));
  });

  it("derives scenarios when none are passed (undefined)", () => {
    const r = simulateAgent(manifest());
    assert.ok(r.total > 0);
    assert.equal(r.verdict, "PASS");
  });
});
