/**
 * tests/research-agent-factory.test.ts — the FIRST real domain agent through the full Factory.
 *
 * Proves the breadth machinery end-to-end on RESEARCH_AGENT_SPEC:
 *   compileSpecToManifest → validateManifest (clean) → officiateFromManifest
 *   → quality gate ADMIT → behavioral simulation PASS (boundary bites).
 *
 * This is the trial: a born agent is admitted ONLY because every quality + behavioral gate passes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RESEARCH_AGENT_SPEC } from "../src/agents/research-agent-spec.js";
import { compileSpecToManifest, validateManifest } from "../src/hartos/manifest-compiler.js";
import { officiateFromManifest } from "../src/hartos/factory-officiator.js";
import type { ReadModelSummary } from "../src/read-models/read-model-types.js";

const NOW = "2026-06-10T12:00:00.000Z";
const FRESH = "2026-06-10T10:00:00.000Z";

// A representative HEALTHY summary for the born read-model bucket ("other").
const HEALTHY: ReadModelSummary = {
  id: "other",
  type: "other",
  status: "ok",
  confidence: "high",
  lines: ["Research dossiers available."],
  metrics: { dossiers: 2 },
  recommendation: "Read-only; review in the cockpit.",
  dataFreshness: FRESH,
  degradedSources: [],
};

describe("Research Agent — full Factory pipeline", () => {
  const manifest = compileSpecToManifest(RESEARCH_AGENT_SPEC);

  it("compiles to a STRUCTURALLY valid manifest (validateManifest clean)", () => {
    assert.deepEqual(validateManifest(manifest), []);
  });

  it("carries a propose-only, approval-gated contract on the 'other' bucket", () => {
    assert.equal(manifest.contract.type, "other");
    assert.equal(manifest.contract.approvalRequired, true);
    assert.ok(manifest.contract.proposalTypes.includes("research_plan"));
    // Born read-only + disabled-by-default.
    assert.equal(manifest.readModel.enabled, false);
  });

  it("officiates, ADMITs on the quality gate, and PASSes the behavioral simulation", () => {
    const outcome = officiateFromManifest(manifest, HEALTHY, { now: NOW });
    assert.equal(outcome.officiated, true, "contract officiates");
    assert.equal(outcome.quality.rating, "ADMIT", `quality: ${outcome.quality.summary}`);
    assert.equal(outcome.quality.score, 100);
    assert.equal(outcome.simulation.verdict, "PASS", `sim: ${outcome.simulation.summary}`);
    // The boundary must actually bite (declared network/LLM are allowed, but depth + a denied
    // source must still be refused) — a simulation that never refuses proves nothing.
    assert.equal(outcome.simulation.boundaryBites, true);
  });

  it("the persist proposal is non-executable (born agents never self-admit)", () => {
    const outcome = officiateFromManifest(manifest, HEALTHY, { now: NOW });
    assert.equal(outcome.persistProposal.executable, false);
    assert.equal(outcome.persistProposal.proposedPayload["dryRun"], true);
  });
});
