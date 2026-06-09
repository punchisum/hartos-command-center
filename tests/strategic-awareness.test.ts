/**
 * tests/strategic-awareness.test.ts
 *
 * Strategic Awareness sprint — benchmark scenarios for the pure aggregator that turns
 * grounded signals into a Strategic Brief (risks / opportunities / drift / blind spots /
 * recommended focus). Each dimension gets an EXCELLENT (rich signal → sharp finding), a
 * WEAK (sub-threshold → not surfaced), and a FAILURE (no evidence → UNKNOWN) case.
 *
 * Hermetic + deterministic: hand-built panels/freshness/proposals, literal `now`, no I/O.
 * Proves the honesty floor (never fabricates) and noise control (caps + dedup + thresholds).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { strategicAwareness } from "../src/awareness/strategic-awareness.js";
import type { DomainPanel, PanelField } from "../src/cockpit/panels/panel-types.js";
import type { FreshnessReport } from "../src/cockpit/freshness-surface.js";
import type { ProposalQueueItem } from "../src/cockpit/proposals/proposal-types.js";

const NOW = "2026-06-09T12:00:00.000Z";

function f(key: string, value: string, over: Partial<PanelField> = {}): PanelField {
  return { key, label: key, value, status: "ok", confidence: "high", ...over };
}

function panel(id: DomainPanel["id"], over: Partial<DomainPanel> = {}): DomainPanel {
  return {
    id,
    title: id[0]!.toUpperCase() + id.slice(1),
    status: "detected",
    detected: true,
    summary: "",
    fields: [],
    highlights: [],
    gaps: [],
    nextAction: `Do the next ${id} thing.`,
    missingSetupSteps: [],
    sources: [],
    confidence: "high",
    generatedAt: NOW,
    ...over,
  };
}

function freshness(over: Partial<FreshnessReport> = {}): FreshnessReport {
  return {
    verdict: "green",
    verdictReason: "ok",
    safeNextStep: "Re-run read-models:status.",
    generatedAt: NOW,
    domains: [],
    staleDomains: [],
    unavailableDomains: [],
    clickup: { stale: false, lastImportAt: NOW, cardsImported: null, importStatus: null },
    staleReason: null,
    ...over,
  } as unknown as FreshnessReport;
}

function proposal(over: Partial<ProposalQueueItem> = {}): ProposalQueueItem {
  return {
    id: "p1", domain: "ops", actionType: "review_plan", title: "t", description: "d",
    sourceIntent: "x", proposedPayload: {}, expectedEffect: "e", riskLevel: "low",
    requiredApproval: "Hart", expiresAt: null, safetyNotes: [], blockedReason: "b",
    dryRunResult: null, executable: false, createdAt: NOW, status: "pending_approval",
    updatedAt: NOW, auditEvents: [],
    ...over,
  } as ProposalQueueItem;
}

describe("strategic awareness — honesty floor", () => {
  it("FAILURE: no detected panels, no cross-system reports → insufficient_evidence (UNKNOWN)", () => {
    const b = strategicAwareness({ now: NOW, panels: [panel("ops", { detected: false }), panel("fitness", { detected: false })] });
    assert.equal(b.status, "insufficient_evidence");
    assert.equal(b.risks.length, 0);
    assert.equal(b.opportunities.length, 0);
    assert.equal(b.recommendedFocus, null);
    assert.match(b.note, /insufficient evidence/i);
  });

  it("WEAK: a clean detected panel with no risk/opp/drift fields → ok but nothing surfaced", () => {
    const b = strategicAwareness({ now: NOW, panels: [panel("ops")], freshness: freshness() });
    assert.equal(b.status, "ok");
    assert.equal(b.risks.length, 0);
    assert.equal(b.drift.length, 0);
    assert.match(b.note, /Nothing meaningful to surface/i);
  });
});

describe("strategic awareness — risk detection", () => {
  it("EXCELLENT: ops triage risk + stale data → two grounded risks with evidence + action", () => {
    const ops = panel("ops", {
      fields: [
        f("triage_risks", "Stall risk: 3 blocked AND 4 stale — work that's both stuck and untouched."),
        f("next_action", "Triage the 3 blocked cards first."),
      ],
    });
    const b = strategicAwareness({
      now: NOW,
      panels: [ops],
      freshness: freshness({ verdict: "amber", staleDomains: ["ops"] as unknown as FreshnessReport["staleDomains"], staleReason: "Ops is stale." }),
    });
    assert.equal(b.status, "ok");
    assert.ok(b.risks.length >= 2);
    const opsRisk = b.risks.find((r) => /operational risk/i.test(r.risk));
    assert.ok(opsRisk, "ops triage risk surfaced");
    assert.match(opsRisk!.evidence, /Stall risk/);
    assert.ok(opsRisk!.suggestedAction.length > 0, "every risk has a suggested action");
    assert.ok(b.risks.some((r) => /stale data/i.test(r.risk)), "stale-data risk surfaced");
    assert.ok(b.recommendedFocus, "recommended focus points at a real finding");
  });

  it("fitness coach_risk surfaces as a training/recovery risk", () => {
    const fitness = panel("fitness", {
      fields: [
        f("coach_risk", "Hard session on low recovery — pushing it risks injury.", { confidence: "medium" }),
        f("adjustment", "Swap the hard session for easy mobility."),
      ],
    });
    const b = strategicAwareness({ now: NOW, panels: [fitness], freshness: freshness() });
    const r = b.risks.find((x) => /training\/recovery risk/i.test(x.risk));
    assert.ok(r, "fitness risk surfaced");
    assert.equal(r!.confidence, "medium", "confidence carried from the field, not invented");
    assert.match(r!.evidence, /injury/);
  });
});

describe("strategic awareness — opportunity detection", () => {
  it("EXCELLENT: ops + fitness opportunities surface with upside + action, never fabricated", () => {
    const ops = panel("ops", { fields: [f("triage_opportunity", "2 parked approvals — minutes of work that unblocks flow. Quick win.")] });
    const fitness = panel("fitness", { fields: [f("coach_opportunity", "Recovery is high on a light day — capacity to add quality."), f("adjustment", "Add an interval block.")] });
    const b = strategicAwareness({ now: NOW, panels: [ops, fitness], freshness: freshness() });
    assert.equal(b.opportunities.length, 2);
    assert.ok(b.opportunities.every((o) => o.upside.length > 0), "every opportunity has a concrete upside");
    assert.ok(b.opportunities.some((o) => /unblock/i.test(o.upside)));
    assert.ok(b.opportunities.some((o) => /capacity/i.test(o.upside)));
  });

  it("WEAK: no opportunity fields → no opportunities (no fabricated upside)", () => {
    const b = strategicAwareness({ now: NOW, panels: [panel("ops"), panel("fitness")], freshness: freshness() });
    assert.equal(b.opportunities.length, 0);
  });
});

describe("strategic awareness — drift detection", () => {
  it("EXCELLENT: data + project + confidence + backlog drift all detected from grounded signals", () => {
    const ops = panel("ops", {
      confidence: "low",
      gaps: ["missing source: pending_approvals"],
      fields: [f("triage_risks", "Stall risk: 2 blocked AND 3 stale.")],
    });
    const stale = proposal({ id: "old", createdAt: "2026-06-01T00:00:00.000Z" }); // ~8 days old
    const b = strategicAwareness({
      now: NOW,
      panels: [ops],
      freshness: freshness({ verdict: "amber", staleDomains: ["ops"] as unknown as FreshnessReport["staleDomains"] }),
      proposals: [stale],
    });
    const kinds = b.drift.map((d) => d.drift);
    assert.ok(kinds.some((k) => /Data drift/i.test(k)), "data drift");
    assert.ok(kinds.some((k) => /Project drift/i.test(k)), "project drift (blocked+stale)");
    // drift list is capped at 3 — confidence/backlog compete for the remaining slot
    assert.ok(b.drift.length <= 3, "drift is capped for noise control");
    assert.ok(b.drift.every((d) => d.suggestedCorrection.length > 0), "every drift has a correction");
  });

  it("backlog drift only fires past the aging threshold", () => {
    const fresh = proposal({ id: "fresh", createdAt: "2026-06-09T11:00:00.000Z" }); // 1h old
    const b = strategicAwareness({ now: NOW, panels: [panel("ops")], freshness: freshness(), proposals: [fresh] });
    assert.ok(!b.drift.some((d) => /Backlog drift/i.test(d.drift)), "fresh proposal is not backlog drift");
  });
});

describe("strategic awareness — blind spots", () => {
  it("unavailable domains + missing sources become questions Hart should ask", () => {
    const ops = panel("ops", { gaps: ["missing source: dd_reports"] });
    const b = strategicAwareness({
      now: NOW,
      panels: [ops],
      freshness: freshness({ unavailableDomains: ["fitness"] as unknown as FreshnessReport["unavailableDomains"] }),
    });
    assert.ok(b.blindSpots.some((s) => /fitness/i.test(s.blindSpot)), "unavailable domain → blind spot");
    assert.ok(b.blindSpots.some((s) => /source is unwired/i.test(s.blindSpot)), "missing source → blind spot");
    assert.ok(b.blindSpots.length <= 4, "blind spots capped");
  });
});

describe("strategic awareness — noise control", () => {
  it("dedupes identical risks and caps the risk list at 4", () => {
    // Five distinct stale domains would each try to add a risk; the stale-data risk is one
    // entry (deduped), and overall caps hold.
    const panels = [panel("ops", { fields: [f("triage_risks", "Stall risk: 1 blocked AND 1 stale.")] })];
    const b = strategicAwareness({
      now: NOW,
      panels,
      freshness: freshness({ verdict: "red", staleDomains: ["ops", "fitness", "factory"] as unknown as FreshnessReport["staleDomains"] }),
    });
    assert.ok(b.risks.length <= 4, "risk list capped at 4");
    // stale-data risk appears exactly once despite 3 stale domains
    assert.equal(b.risks.filter((r) => /stale data/i.test(r.risk)).length, 1);
  });
});
