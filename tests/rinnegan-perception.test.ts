/**
 * tests/rinnegan-perception.test.ts — Phase F2.
 *
 * Rinnegan's deterministic perception: staleness / drift / blind-spot / backlog
 * detection, severity ranking + verdict, and the honesty contract (it names what
 * it `scanned` and the `blindSpots` it can't see; it never invents a problem).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { perceive, summarizePerception } from "../src/rinnegan/perception.js";
import type { FreshnessReport } from "../src/cockpit/freshness-surface.js";
import type { ProposalQueueItem } from "../src/cockpit/proposals/proposal-types.js";

const NOW = "2026-06-08T12:00:00Z";

function dom(domain: string, state: string, lastUpdated = "2026-06-05") {
  return { domain, state, lastUpdated, reason: "r" };
}
function fresh(domains: ReturnType<typeof dom>[], clickupStale = false): FreshnessReport {
  return {
    verdict: "amber", verdictReason: "x", domains,
    clickup: { stale: clickupStale, lastImportAt: null }, staleReason: "", safeNextStep: "x",
  } as unknown as FreshnessReport;
}
function prop(over: Partial<ProposalQueueItem>): ProposalQueueItem {
  return { id: "p", domain: "system", actionType: "review_plan", title: "t", status: "draft", createdAt: NOW, ...over } as unknown as ProposalQueueItem;
}

describe("rinnegan perception (Phase F2)", () => {
  it("flags ops staleness as critical → verdict attention", () => {
    const r = perceive({ now: NOW, freshness: fresh([dom("ops", "stale")]) });
    const o = r.observations.find((x) => x.subject === "ops")!;
    assert.equal(o.kind, "staleness");
    assert.equal(o.severity, "critical");
    assert.equal(r.verdict, "attention");
    assert.ok(r.scanned.includes("data freshness"));
  });

  it("distinguishes drift (reports_only) and blind spots (unavailable)", () => {
    const r = perceive({ now: NOW, freshness: fresh([dom("ops", "reports_only"), dom("fitness", "unavailable")]) });
    assert.equal(r.observations.find((x) => x.subject === "ops")!.kind, "drift");
    const fit = r.observations.find((x) => x.subject === "fitness")!;
    assert.equal(fit.kind, "blind_spot");
    assert.ok(r.blindSpots.includes("fitness"), "unseeable domain is named a blind spot");
  });

  it("flags a stale ClickUp import as critical", () => {
    const r = perceive({ now: NOW, freshness: fresh([dom("ops", "fresh")], true) });
    assert.ok(r.observations.some((o) => o.subject === "clickup" && o.severity === "critical"));
  });

  it("names configured-but-missing sources as blind spots", () => {
    const r = perceive({ now: NOW, freshness: fresh([]), missingSources: ["HARTOS_OPS_SUPABASE_READONLY_KEY"] });
    assert.ok(r.blindSpots.includes("HARTOS_OPS_SUPABASE_READONLY_KEY"));
    assert.ok(r.scanned.includes("source diagnostics"));
  });

  it("flags aging pending proposals as backlog", () => {
    const r = perceive({
      now: NOW, freshness: fresh([dom("ops", "fresh")]),
      proposals: [prop({ status: "pending_approval", createdAt: "2026-06-01T00:00:00Z" })], // ~7.5d old
    });
    const b = r.observations.find((o) => o.kind === "backlog")!;
    assert.equal(b.severity, "warn");
    assert.match(b.detail, /pending more than/);
  });

  it("is honest when it can see nothing — verdict clear, freshness a blind spot", () => {
    const r = perceive({ now: NOW, freshness: null });
    assert.equal(r.verdict, "clear");
    assert.deepEqual(r.observations, []);
    assert.ok(r.blindSpots.some((b) => /data freshness/.test(b)));
  });

  it("ranks observations by severity (critical first)", () => {
    const r = perceive({
      now: NOW,
      freshness: fresh([dom("ops", "stale"), dom("fitness", "unavailable")], false),
      missingSources: ["X"],
    });
    const sev = r.observations.map((o) => o.severity);
    // critical (ops) before warn (fitness blind spot) before info (missing source X)
    assert.equal(sev[0], "critical");
    assert.ok(sev.indexOf("warn") < sev.indexOf("info"));
  });

  it("is deterministic and summarizes honestly", () => {
    const input = { now: NOW, freshness: fresh([dom("ops", "stale")]) };
    assert.deepEqual(perceive(input), perceive(input));
    assert.match(summarizePerception(perceive(input)), /Perception ATTENTION —/);
  });
});
