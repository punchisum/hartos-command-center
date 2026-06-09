/**
 * tests/cockpit-hosted-page.test.ts — Blueprint v2 reskin + depth (Phase C/D).
 *
 * Locks in the Style 5 hosted landing structure and the progressive-enhancement
 * depth: sidebar shell + system verdict, inline Ask + ⌘K palette, the quick-peek
 * detail drawer, and the Recent-activity panel surfacing the Gap D thread spine.
 * Renders with an undefined state (honest placeholders) so it tests structure, not
 * data — and that dynamic thread content is HTML-escaped.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderHostedCockpitPage } from "../src/runtime/cloudflare-cockpit-page.js";
import type { CockpitState } from "../src/cockpit/cockpit-types.js";

const NOW = "2026-06-08T10:00:00Z";
const html = renderHostedCockpitPage(undefined, {
  runtimeMode: "hosted",
  generatedAt: NOW,
  now: NOW,
  threads: [
    { threadId: "thread-1", createdAt: NOW, updatedAt: NOW, entryCount: 2, latestRequest: "Create a tax agent", latestIntent: "build_agent", latestSummary: "Build plan drafted." },
  ],
});

describe("hosted cockpit page — Style 5 structure + depth", () => {
  it("renders the Style 5 shell (sidebar + system verdict + read-only)", () => {
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /class="app"/);
    assert.match(html, /class="side"/);
    assert.match(html, /SYSTEM STATUS/);
    assert.match(html, /read-only/);
  });

  it("includes the inline Ask bar AND the ⌘K command palette", () => {
    assert.match(html, /id="ask-form"/);
    assert.match(html, /id="q"/);
    assert.match(html, /id="kbar"/);
    assert.match(html, /id="kq"/);
    assert.match(html, /⌘K/);
    // 1.6: the research planner is discoverable via an Ask chip (routes to the research intent)
    assert.match(html, /data-q="Research if CoachOS is worth building"/);
  });

  it("includes the quick-peek detail drawer scaffold", () => {
    assert.match(html, /id="drawer"/);
    assert.match(html, /id="dbody"/);
    assert.match(html, /class="overlay"/);
  });

  it("surfaces recent threads (Gap D spine) in the activity panel", () => {
    assert.match(html, /Recent activity/);
    assert.match(html, /Create a tax agent/);
    assert.match(html, /build_agent/);
  });

  it("renders always-present panels: trust + proposals + freshness + suggestions", () => {
    assert.match(html, /Can I trust the system\?/);
    assert.match(html, /Proposal queue/);
    assert.match(html, /Data freshness/);
    assert.match(html, /Suggested actions/);
  });

  it("always renders intelligence panels; suppresses factory-jobs when empty", () => {
    // Intelligence panels (perception, orchestration, forecast) always render — even with
    // undefined state they're populated from missing-source observations and fleet tasks.
    assert.match(html, /Perception \(Rinnegan\)/);
    assert.match(html, /Orchestration \(Fleet OS\)/);
    assert.match(html, /Forecast \(Prophet\)/);
    // Factory jobs box is hidden when no jobs exist (total=0, go-live wiring not yet done).
    assert.ok(!html.includes("Factory Agent"), "factory-jobs panel should be hidden when total=0");
  });

  it("HTML-escapes dynamic thread content (no injection)", () => {
    const evil = renderHostedCockpitPage(undefined, {
      now: NOW,
      threads: [{ threadId: "t", createdAt: NOW, updatedAt: NOW, entryCount: 1, latestRequest: "<script>x</script>", latestIntent: "i", latestSummary: "s" }],
    });
    assert.ok(!evil.includes("<script>x</script>"), "raw injected markup must not appear");
    assert.match(evil, /&lt;script&gt;x&lt;\/script&gt;/);
  });

  it("works without threads (honest empty activity, no fabrication)", () => {
    const bare = renderHostedCockpitPage(undefined, { now: NOW });
    assert.match(bare, /Recent activity/);
    assert.match(bare, /No recent threads/);
  });

  it("surfaces the coach headline on the fitness fleet card (from the baked panel)", () => {
    const state = {
      generatedAt: NOW,
      readModels: {
        configPresent: true, configuredReadModels: 1, enabledReadModels: 1,
        summaries: [{ id: "fitness", type: "fitness", status: "ok", confidence: "high", lines: [], metrics: { recovery: "66" }, recommendation: "read-only", dataFreshness: NOW, degradedSources: [] }],
      },
      panels: [{
        id: "fitness", title: "Fitness Agent", status: "detected", detected: true, summary: "x",
        fields: [{ key: "adjustment", label: "Next recommended adjustment", value: "Proceed with the planned session", status: "ok", confidence: "medium", source: "derived (coach)" }],
        highlights: [], gaps: [], nextAction: "x", missingSetupSteps: [], sources: [], confidence: "medium", generatedAt: NOW,
      }],
      proposalQueue: [],
    } as unknown as CockpitState;
    const html = renderHostedCockpitPage(state, { now: NOW });
    assert.match(html, /Proceed with the planned session/, "the coach call appears on the fleet card");
  });
});
