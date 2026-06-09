/**
 * tests/cockpit-suggestions-view.test.ts
 *
 * cockpitSuggestions is the production seam both the landing panel and the persist
 * route depend on. It folds the per-agent headline calls (fitness coach + ops triage,
 * read from each panel's `advisory`) into the cross-system synthesis — so "do next"
 * includes them, not just the cross-system items — and only when their verdict calls
 * for action. (Pre-computed perception/plan/forecast are passed empty to isolate the
 * coach/triage fold-in.)
 *
 * It ALSO folds in the CROSS-AGENT synthesis suggestions: the multi-source correlated risks from
 * `synthesizeFleet` over the SAME perception+forecast (a single-source pass cannot see them),
 * merged through the EXACT dedup-by-title + rank + cap pass — completing the Track B wiring so the
 * panel and the persist route both surface them, deduped. The floor is unchanged: every surfaced
 * action stays a non-executable proposal candidate (requiredApproval "Hart").
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cockpitSuggestions } from "../src/runtime/cloudflare-cockpit-views.js";
import { suggestionToProposal, type SuggestedAction } from "../src/cockpit/suggestions/suggest-actions.js";
import { SYNTHESIS_ID_PREFIX } from "../src/cockpit/suggestions/synthesis-suggestions.js";
import { perceive } from "../src/rinnegan/perception.js";
import { forecast } from "../src/prophet/forecast.js";
import type { FreshnessReport } from "../src/cockpit/freshness-surface.js";
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

  it("folding in EMPTY synthesis (no correlated risks) adds nothing — only coach/triage surface", () => {
    const state = stateWith([
      panel("fitness", { verdict: "prioritize_recovery", priority: "high", act: true, headline: "Recovery is low — rest or go light today." }),
    ]);
    const { actions } = cockpitSuggestions(state, NOW, EMPTY_PRE);
    // EMPTY_PRE perception+forecast carry no subjects ⇒ synthesizeFleet finds no correlated risk.
    assert.ok(!actions.some((a) => a.id.startsWith(`${SYNTHESIS_ID_PREFIX}-`)), "no synthesis suggestion when inputs don't correlate");
    assert.ok(actions.some((a) => a.source === "coach"), "the single-source coach call still surfaces");
  });
});

// ─── CROSS-AGENT synthesis fold (Track B wiring completed) ────────────────────────
//
// When perception AND forecast name the SAME subject, synthesizeFleet correlates it (2 sources)
// and cockpitSuggestions must surface the resulting `sx-syn-` cross-agent suggestion — net-new
// over the single-source pass — through the same deduped, ranked, non-executable pipeline.

function dom(domain: string, state: string) {
  return { domain, state, lastUpdated: "2026-06-05", reason: "r" };
}
function fresh(domains: ReturnType<typeof dom>[], clickupStale = false): FreshnessReport {
  return {
    verdict: "amber", verdictReason: "x", domains,
    clickup: { stale: clickupStale, lastImportAt: null }, staleReason: "", safeNextStep: "x",
  } as unknown as FreshnessReport;
}
/** perception(stale ops) + forecast(perception) → "ops" correlated across BOTH sources, no briefing. */
function correlatedPre(): Parameters<typeof cockpitSuggestions>[2] {
  const perception = perceive({ now: NOW, freshness: fresh([dom("ops", "stale")]) });
  const fcast = forecast({ now: NOW, perception });
  return { perception, forecast: fcast } as unknown as Parameters<typeof cockpitSuggestions>[2];
}

describe("cockpitSuggestions — folds in the cross-agent synthesis (correlated) suggestions", () => {
  it("surfaces a cross-agent (correlated) synthesis suggestion when perception + forecast agree", () => {
    const state = stateWith([]);
    const { actions } = cockpitSuggestions(state, NOW, correlatedPre());
    const syn = actions.find((a) => a.id.startsWith(`${SYNTHESIS_ID_PREFIX}-`));
    assert.ok(syn, "a correlated cross-agent synthesis suggestion reaches the merged 'do next' list");
    // It is the net-new cross-agent surface: its id is the distinct synthesis namespace, never sg-.
    assert.ok(!syn!.id.startsWith("sg-"), "synthesis ids never collide with the suggest-actions scheme");
    assert.match(syn!.rationale, /Correlated across/, "rationale honestly names the cross-agent corroboration");
  });

  it("title-dedups: at most ONE action per normalized title even after the synthesis fold", () => {
    const { actions } = cockpitSuggestions(stateWith([]), NOW, correlatedPre());
    const titles = actions.map((a) => a.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
    assert.equal(new Set(titles).size, titles.length, "no two surfaced actions share a normalized title");
  });

  it("respects the cap and ranks high priority first after the fold", () => {
    const { actions } = cockpitSuggestions(stateWith([]), NOW, correlatedPre());
    assert.ok(actions.length <= 6, "the merged list stays capped at the focused 'do next' size");
    for (let i = 1; i < actions.length; i++) {
      const rank = (p: SuggestedAction["priority"]) => (p === "high" ? 3 : p === "medium" ? 2 : 1);
      assert.ok(rank(actions[i - 1]!.priority) >= rank(actions[i]!.priority), "ranked high → low");
    }
  });

  it("FLOOR: every surfaced action (incl. synthesis) maps to a non-executable draft, approval Hart", () => {
    const { actions } = cockpitSuggestions(stateWith([]), NOW, correlatedPre());
    assert.ok(actions.some((a) => a.id.startsWith(`${SYNTHESIS_ID_PREFIX}-`)), "precondition: a synthesis action is present");
    for (const a of actions) {
      const draft = suggestionToProposal(a, NOW);
      assert.equal(draft.executable, false, "non-executable — the human-approval floor never moves");
      assert.equal(draft.status, "draft");
      assert.equal(draft.requiredApproval, "Hart");
    }
  });

  it("drops a synthesis suggestion whose title is already decided in the persisted queue", () => {
    // First learn the synthesis suggestion's title, then put it in the queue and re-run.
    const seed = cockpitSuggestions(stateWith([]), NOW, correlatedPre());
    const synAction = seed.actions.find((a) => a.id.startsWith(`${SYNTHESIS_ID_PREFIX}-`))!;
    assert.ok(synAction, "precondition: a synthesis suggestion exists to suppress");
    const withQueued = {
      generatedAt: NOW,
      panels: [],
      proposalQueue: [{ id: synAction.id, title: synAction.title, status: "rejected", domain: synAction.domain, actionType: synAction.actionType }],
    } as unknown as CockpitState;
    const { actions } = cockpitSuggestions(withQueued, NOW, correlatedPre());
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    assert.ok(!actions.some((a) => norm(a.title) === norm(synAction.title)), "an already-decided synthesis title is not re-suggested");
  });

  it("is deterministic with the synthesis fold", () => {
    assert.deepEqual(
      cockpitSuggestions(stateWith([]), NOW, correlatedPre()),
      cockpitSuggestions(stateWith([]), NOW, correlatedPre()),
    );
  });
});
