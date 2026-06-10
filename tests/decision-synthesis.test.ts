/**
 * tests/decision-synthesis.test.ts
 *
 * The Chief-of-Staff synthesis. The intelligence under test is CORROBORATION: a topic flagged by
 * multiple independent brains (forecast + risk + memory + cross-agent) must outrank a single-signal
 * topic, and the directive fields (the ask, the cost of waiting) come from the most directive brain.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { synthesizeDecisions } from "../src/cockpit/decision-synthesis.js";
import type { StrategicBrief } from "../src/awareness/strategic-awareness.js";
import type { ForecastReport } from "../src/prophet/forecast.js";
import type { ExecutiveMemoryReport } from "../src/awareness/executive-memory.js";

const NOW = "2026-06-10T12:00:00.000Z";

const brief = {
  status: "ok",
  risks: [{ risk: "Ops backlog growing", why: "too many open cards", evidence: "12 open", confidence: "high", suggestedAction: "triage ops" }],
  opportunities: [],
  drift: [],
  blindSpots: [],
  recommendedFocus: null,
  note: "",
} as unknown as StrategicBrief;

const forecastReport = {
  verdict: "degrading",
  consequences: [
    { subject: "ops", projection: "every ops decision stays wrong until refreshed", severity: "high", horizon: "now", basis: "ops stale", preventedBy: "refresh ops" },
    { subject: "capability absorption", projection: "scouted gaps stay open", severity: "medium", horizon: "week+", basis: "scouted not absorbed", preventedBy: "absorb a scout" },
  ],
  scanned: [],
  blindSpots: [],
} as unknown as ForecastReport;

const memory = {
  status: "ok",
  recurringPatterns: [{ kind: "risk", subject: "ops stale", occurrences: 4, evidence: "4x in 60d", windowDays: 60, firstSeen: "", lastSeen: "", qualityScore: 5 }],
  trends: [],
  lessons: [],
  decisions: [],
  note: "",
} as unknown as ExecutiveMemoryReport;

const crossAgentRisks = [{ subject: "ops", sources: ["fitness briefing", "ops"], confidence: "high" }];

describe("synthesizeDecisions — corroboration is the signal", () => {
  const d = synthesizeDecisions({ now: NOW, brief, forecast: forecastReport, memory, crossAgentRisks });

  it("ranks the multi-brain topic first, with high leverage", () => {
    assert.equal(d.status, "ok");
    assert.match(d.decisions[0]!.title, /ops/i);
    assert.equal(d.decisions[0]!.leverage, "high");
  });

  it("records every brain that corroborated the top topic", () => {
    const corr = d.decisions[0]!.corroboration;
    for (const sig of ["forecast", "risk", "memory", "cross-agent"]) assert.ok(corr.includes(sig), `missing ${sig}`);
  });

  it("takes the ask + cost-of-waiting from the most directive brain (forecast)", () => {
    assert.equal(d.decisions[0]!.theAsk, "refresh ops");
    assert.equal(d.decisions[0]!.costOfInaction, "every ops decision stays wrong until refreshed");
  });

  it("a single-signal topic ranks below the corroborated one", () => {
    const ops = d.decisions[0]!;
    const cap = d.decisions.find((x) => /capability/i.test(x.title));
    assert.ok(cap, "the single-signal capability topic still surfaces");
    assert.ok(ops.score > cap!.score, "corroborated topic outscores the single-signal one");
  });

  it("the headline names the top decision + the ask", () => {
    assert.match(d.headline, /refresh ops/);
  });
});

describe("synthesizeDecisions — honest + deterministic", () => {
  it("is insufficient_evidence when no brain produced anything", () => {
    const empty = synthesizeDecisions({ now: NOW });
    assert.equal(empty.status, "insufficient_evidence");
    assert.equal(empty.decisions.length, 0);
  });

  it("is deterministic for a given input", () => {
    const a = synthesizeDecisions({ now: NOW, brief, forecast: forecastReport, memory, crossAgentRisks });
    const b = synthesizeDecisions({ now: NOW, brief, forecast: forecastReport, memory, crossAgentRisks });
    assert.deepEqual(a, b);
  });
});
