/**
 * tests/fleet-signals.test.ts — Workstream C (X1).
 * The cockpit maps each agent's read-model summary onto the shared AgentSignal and
 * renders a unified fleet view with NO bespoke per-agent glue. confidence is derived
 * (never faked), freshness is honest from the data's age.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fleetSignals, renderFleetView, summaryToAgentSignal, type AgentSignal } from "../src/read-models/agent-signal.js";
import type { ReadModelSummary } from "../src/read-models/read-model-types.js";

const SHAPE = ["verdict", "confidence", "facts", "freshness", "reason", "nextAction", "approvalNeeded"] as const;

function assertShape(sig: AgentSignal): void {
  for (const k of SHAPE) assert.ok(k in sig, `AgentSignal must expose ${k}`);
  assert.ok(["high", "medium", "low", "unknown"].includes(sig.confidence));
  assert.ok(["live", "fresh", "stale", "dead", "unknown"].includes(sig.freshness));
  assert.equal(typeof sig.approvalNeeded, "boolean");
  assert.ok(Array.isArray(sig.facts) && sig.facts.length > 0);
  for (const f of sig.facts) {
    assert.ok(typeof f.key === "string" && "value" in f && "asOf" in f && typeof f.source === "string");
  }
}

const now = new Date("2026-06-06T08:00:00+08:00");

const fitnessOk: ReadModelSummary = {
  id: "fitness_supabase_read",
  type: "fitness",
  status: "ok",
  confidence: "high",
  lines: ["Today state resolved (read-only RPC)."],
  metrics: { recovery: "green", healthVitals: "HRV 55ms" },
  recommendation: "Read-only; review in the cockpit.",
  dataFreshness: "2026-06-06T06:00:00+08:00",
  degradedSources: [],
};

const opsUrgent: ReadModelSummary = {
  id: "ops_supabase_read",
  type: "ops",
  status: "ok",
  confidence: "high",
  lines: ["Active cards: 5 (urgent:2, blocked:1, waiting:0, stale:3, no-action:0)."],
  metrics: { activeCards: 5, urgentCards: 2, blockedCards: 1, waitingCards: 0, staleCards: 3 },
  recommendation: "Read-only; review in the cockpit.",
  dataFreshness: "2026-06-06T06:00:00+08:00",
  degradedSources: [],
};

const fitnessMissing: ReadModelSummary = {
  id: "fitness_supabase_read",
  type: "fitness",
  status: "missing",
  confidence: "low",
  lines: ["Fitness read model enabled but env/client missing."],
  metrics: {},
  recommendation: "Set the Supabase URL + read-only key env vars.",
  dataFreshness: null,
  degradedSources: [],
};

describe("fleet signals (X1 contract)", () => {
  it("maps fitness recovery → verdict; confidence derived; freshness live (2h old)", () => {
    const sig = summaryToAgentSignal(fitnessOk, { now });
    assertShape(sig);
    assert.equal(sig.verdict, "green");
    assert.equal(sig.confidence, "high");
    assert.equal(sig.freshness, "live");
    assert.equal(sig.approvalNeeded, false, "fitness is advisory");
  });

  it("bands a numeric recovery score → tone-legible verdict (the UNKNOWN-on-fresh-data bug)", () => {
    const verdictFor = (recovery: string): string =>
      summaryToAgentSignal({ ...fitnessOk, metrics: { ...fitnessOk.metrics, recovery } }, { now }).verdict;
    assert.equal(verdictFor("80"), "green", "≥67 → green");
    assert.equal(verdictFor("66"), "amber", '34–66 → amber (was a bare "66" → idle)');
    assert.equal(verdictFor("20"), "red", "<34 → red");
  });

  it("ok read with no recovery metric stays unknown — never a faked green", () => {
    const sig = summaryToAgentSignal({ ...fitnessOk, metrics: { healthVitals: "HRV 55ms" } }, { now });
    assert.equal(sig.verdict, "unknown");
  });

  it("maps ops counts → urgent verdict; approval required", () => {
    const sig = summaryToAgentSignal(opsUrgent, { now });
    assertShape(sig);
    assert.equal(sig.verdict, "urgent");
    assert.equal(sig.approvalNeeded, true, "ops proposals need approval");
  });

  it("a missing read yields unknown confidence — never faked", () => {
    const sig = summaryToAgentSignal(fitnessMissing, { now });
    assertShape(sig);
    assert.equal(sig.confidence, "unknown");
    assert.equal(sig.freshness, "unknown", "no timestamp → unknown, not fresh");
    assert.equal(sig.verdict, "missing");
  });

  it("fleetSignals + renderFleetView handle BOTH agents with no bespoke glue", () => {
    const fleet = fleetSignals([fitnessOk, opsUrgent], { now });
    assert.equal(fleet.length, 2);
    for (const entry of fleet) assertShape(entry.signal);
    const view = renderFleetView(fleet);
    assert.match(view, /fitness \(fitness_supabase_read\)/);
    assert.match(view, /ops \(ops_supabase_read\)/);
    assert.match(view, /verdict=green/);
    assert.match(view, /verdict=urgent/);
    assert.match(view, /approval=required/);
    assert.match(view, /approval=no/);
  });
});
