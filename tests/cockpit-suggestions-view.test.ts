/**
 * tests/cockpit-suggestions-view.test.ts
 *
 * cockpitSuggestions is the production seam both the landing panel and the persist
 * route depend on. It folds the per-agent headline calls (fitness coach + ops triage,
 * read from each panel's `advisory`) into the cross-system synthesis — so "do next"
 * includes them, not just the cross-system items — and only when their verdict calls
 * for action. (Pre-computed perception/plan/forecast are passed empty to isolate the
 * coach/triage fold-in.)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cockpitSuggestions } from "../src/runtime/cloudflare-cockpit-views.js";
import type { CockpitState } from "../src/cockpit/cockpit-types.js";

const NOW = "2026-06-08T12:00:00Z";
// Empty cross-system artifacts → the only suggestions can come from coach/triage.
const EMPTY_PRE = {
  perception: { verdict: "clear", observations: [], scanned: [], blindSpots: [] },
  plan: { verdict: "idle", assignments: [], deferred: [], perAgent: [], reconciliation: [] },
  forecast: { verdict: "stable", consequences: [], scanned: [], blindSpots: [] },
} as unknown as Parameters<typeof cockpitSuggestions>[2];

function panel(id: string, advisory: unknown): unknown {
  return { id, title: id, status: "detected", detected: true, summary: "", fields: [], highlights: [], gaps: [], nextAction: "", missingSetupSteps: [], sources: [], confidence: "high", advisory, generatedAt: NOW };
}
function stateWith(panels: unknown[]): CockpitState {
  return { generatedAt: NOW, proposalQueue: [], panels } as unknown as CockpitState;
}

describe("cockpitSuggestions — folds coach/triage into the synthesis", () => {
  it("includes the fitness coach + ops triage headline when they call for action", () => {
    const state = stateWith([
      panel("fitness", { verdict: "prioritize_recovery", priority: "high", act: true, headline: "Recovery is low — rest or go light today." }),
      panel("ops", { verdict: "urgent", priority: "high", act: true, headline: "Triage 2 blocked card(s) first." }),
    ]);
    const { actions } = cockpitSuggestions(state, NOW, EMPTY_PRE);
    assert.ok(actions.some((a) => a.source === "coach" && /Recovery is low/.test(a.title)), "coach call reaches do-next");
    assert.ok(actions.some((a) => a.source === "triage" && /Triage 2 blocked/.test(a.title)), "triage call reaches do-next");
  });

  it("omits coach/triage when their verdict doesn't call for action", () => {
    const state = stateWith([
      panel("fitness", { verdict: "train_as_planned", priority: "low", act: false, headline: "Proceed as planned." }),
      panel("ops", { verdict: "clear", priority: "low", act: false, headline: "No urgent signal." }),
    ]);
    const { actions } = cockpitSuggestions(state, NOW, EMPTY_PRE);
    assert.ok(!actions.some((a) => a.source === "coach" || a.source === "triage"), "non-actionable verdicts are not surfaced");
  });

  it("is deterministic", () => {
    const state = stateWith([panel("fitness", { verdict: "train_modified", priority: "medium", act: true, headline: "Cap the hard session." })]);
    assert.deepEqual(cockpitSuggestions(state, NOW, EMPTY_PRE), cockpitSuggestions(state, NOW, EMPTY_PRE));
  });
});
