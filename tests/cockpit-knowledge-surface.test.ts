/**
 * tests/cockpit-knowledge-surface.test.ts — the unified cockpit Knowledge & Intelligence surface.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeKnowledgeSurface, renderKnowledgeSurface } from "../src/cockpit/knowledge-surface.js";
import type { WolverineReport } from "../src/wolverine/wolverine-types.js";
import type { ForecastReport } from "../src/prophet/forecast.js";
import type { CapabilityScoutSummary } from "../src/beezulbub/scout-summary.js";

const wolverine: WolverineReport = {
  generatedAt: "x", verdict: "AMBER", verdictReason: "r", findingCount: 2,
  bySeverity: { critical: 0, high: 1, medium: 1, low: 0 },
  topRisks: [{ id: "f1", category: "doctrine_drift", severity: "high", title: "AGPL top pick", evidence: "e", recommendedFix: "f", blastRadius: "b", rollbackPath: "n", approvalRequired: false, confidence: "high", freshness: "now", source: "capability-risk" }],
  repairQueue: [], note: "n",
};
const forecast: ForecastReport = {
  verdict: "degrading",
  consequences: [{ subject: "capability absorption", projection: "gaps stay open", severity: "medium", horizon: "week+", basis: "b", preventedBy: "p" }],
  scanned: ["wolverine", "capability scouts"], blindSpots: [],
};
const scouts: CapabilityScoutSummary[] = [
  { target: "markdown_editor", mode: "live", candidateCount: 5, topCandidate: "vditor", topLicense: "AGPL-3.0", topStaleRisk: "low", riskyTopLicense: true, staleTop: false },
];

describe("composeKnowledgeSurface", () => {
  it("links dossiers + scouts + immune verdict + forecast into one surface", () => {
    const s = composeKnowledgeSurface({
      dossiers: [
        { title: "War economy", type: "research_dossier", confidence: "high", day: "2026-06-10" },
        { title: "markdown_editor", type: "capability_dossier", confidence: "medium", day: "2026-06-10" },
        { title: "Old one", type: "research_dossier", confidence: "low", day: "2026-05-01" },
      ],
      capabilityScouts: scouts,
      wolverine,
      forecast,
    });
    assert.equal(s.dossierCount, 3);
    assert.deepEqual(s.byType, { research_dossier: 2, capability_dossier: 1 });
    assert.equal(s.recent[0].day, "2026-06-10"); // newest first
    assert.equal(s.capabilityScoutCount, 1);
    assert.equal(s.riskyScoutCount, 1);
    assert.equal(s.intel.wolverineVerdict, "AMBER");
    assert.equal(s.intel.forecastVerdict, "degrading");
    assert.match(s.headline, /immune AMBER/);
    assert.match(s.headline, /forecast DEGRADING/);
    assert.ok(renderKnowledgeSurface(s).some((l) => /Knowledge \(3\)/.test(l)));
  });

  it("is honest when nothing is filed", () => {
    const s = composeKnowledgeSurface({});
    assert.equal(s.dossierCount, 0);
    assert.match(s.headline, /nothing filed yet/);
  });
});
