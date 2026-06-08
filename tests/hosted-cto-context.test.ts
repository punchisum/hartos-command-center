/**
 * tests/hosted-cto-context.test.ts — Phase E.
 *
 * The hosted "CTO input brain": classifyRequest + reviewStrategy (both pure) wired
 * into the hosted intent router so build/strategy questions return a REAL
 * risk-rated verdict, while status questions are completely unchanged (no context,
 * zero proposals). No filesystem, no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHostedOrchestratorContext } from "../src/cockpit/hosted-cto-context.js";
import { routeHosted } from "../src/runtime/cloudflare-cockpit-views.js";

const VERDICT = /(BUILD_NOW|BUILD_LATER|DO_NOT_BUILD|NEEDS_MORE_EVIDENCE|DEVOUR_EXISTING_CAPABILITY|MERGE_WITH_EXISTING_AGENT)/;
const NOW = "2026-06-08T00:00:00Z";

describe("hosted CTO input brain — buildHostedOrchestratorContext (Phase E)", () => {
  it("produces a real risk-rated context for a build request", () => {
    const o = buildHostedOrchestratorContext("Build a tax agent");
    assert.ok(o, "build request should get a context");
    assert.equal(o!.classification, "new_agent_build");
    assert.equal(o!.domain, "tax");
    assert.ok(o!.strategyReview && VERDICT.test(o!.strategyReview), "strategy verdict present");
    assert.match(o!.ctoReview ?? "", /capabilit/i);
    assert.match(o!.capabilityGaps, /receipt_ocr/);
    assert.ok(o!.nextRecommendedCommand.length > 0);
  });

  it("flags a value-anchorless cockpit build (cosplay) as build-later", () => {
    const o = buildHostedOrchestratorContext("Should I build a command center dashboard?");
    assert.ok(o);
    assert.ok(o!.strategyReview && VERDICT.test(o!.strategyReview));
    assert.match(o!.strategyReview!, /BUILD_LATER/);
  });

  it("returns undefined for pure status / domain questions (zero behaviour change)", () => {
    assert.equal(buildHostedOrchestratorContext("Anything urgent in ops?"), undefined);
    assert.equal(buildHostedOrchestratorContext("How is my recovery today?"), undefined);
    assert.equal(buildHostedOrchestratorContext("What needs my attention today?"), undefined);
    assert.equal(buildHostedOrchestratorContext("Is my data fresh?"), undefined);
  });
});

describe("hosted /api/ask brain wiring via routeHosted (Phase E)", () => {
  it("a build request now returns a real classification (not 'run it locally')", () => {
    const r = routeHosted(undefined, "Build a tax agent", NOW);
    assert.match(r.summary, /classified as new_agent_build/);
    assert.match(r.summary, /tax/);
    for (const p of r.proposals) assert.equal(p.executable, false);
  });

  it("a strategy review returns a real verdict instead of a deferral", () => {
    const r = routeHosted(undefined, "Give me a strategy review", NOW);
    assert.equal(r.intent, "strategy_review");
    assert.match(r.summary, /Strategy verdict:/);
    assert.match(r.summary, VERDICT);
  });

  it("a status question is unchanged: zero proposals", () => {
    const r = routeHosted(undefined, "Anything urgent in ops?", NOW);
    assert.equal(r.proposals.length, 0);
  });
});
