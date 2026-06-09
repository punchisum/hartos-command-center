/**
 * tests/recent-activity-view.test.ts
 *
 * `recentActivityView` is the PURE read-only cockpit seam that turns a list of recent
 * `StateDeltaSignal`s (src/execution/state-delta.ts §13) into a "what just changed across the
 * fleet" panel. These tests pin: null/undefined → an honest `available: false` note + zero items
 * (no fabricated feed); a few deltas → `available: true` with items projected in INPUT order and
 * every surfaced field present (source/domain/changedEntity/actionType/affectedAgents/freshness +
 * a before→after summary); an empty array → `available: true` + zero items + a DISTINCT honest
 * empty-state note; the `limit` cap → `truncated: true` (honest, no silent drop); `executable`
 * pinned to `"disabled"` with no execute/secret token in the serialized view; and determinism.
 *
 * Hermetic + Worker-safe: hand-built `StateDeltaSignal` fixtures only — no env / network / fs /
 * Supabase / ambient clock, and `StateDeltaSignal` is imported as a TYPE only.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recentActivityView } from "../src/runtime/views/recent-activity-view.js";
import type { StateDeltaSignal } from "../src/execution/state-delta.js";

// ─── Fixtures (all explicit — no hidden defaults that read the clock) ────────────

function delta(over: Partial<StateDeltaSignal> = {}): StateDeltaSignal {
  return {
    source: "clickup-adapter",
    domain: "ops",
    changedEntity: "card: Triage inbound",
    before: { status: "open" },
    after: { status: "done" },
    actionType: "ops_followup_plan",
    auditId: "prop-1",
    affectedAgents: ["Ops Agent", "Fleet Brain"],
    freshness: "live",
    ...over,
  };
}

const D1 = delta({ changedEntity: "card: alpha", auditId: "p1" });
const D2 = delta({ changedEntity: "card: beta", auditId: "p2", domain: "fitness", actionType: "fitness_adjustment_plan", affectedAgents: ["Fitness Agent", "Fleet Brain"] });
const D3 = delta({ changedEntity: "card: gamma", auditId: "p3", freshness: "fresh" });

// ─── null / undefined → honest available: false (never a fabricated feed) ────────

describe("recentActivityView — honest unavailable", () => {
  it("null deltas → available: false with an honest note + zero items", () => {
    const view = recentActivityView(null);
    assert.equal(view.available, false);
    assert.equal(view.items.length, 0);
    assert.equal(view.total, 0);
    assert.match(view.note, /unavailable/i);
    assert.match(view.note, /no delta source/i);
    assert.equal(view.executable, "disabled");
  });

  it("undefined deltas → the same honest unavailable shell", () => {
    const view = recentActivityView(undefined);
    assert.equal(view.available, false);
    assert.equal(view.items.length, 0);
    assert.match(view.note, /unavailable/i);
  });
});

// ─── present deltas → available: true, projected in input order, fields present ──

describe("recentActivityView — available with deltas", () => {
  it("projects each delta in INPUT order with every surfaced field present", () => {
    const view = recentActivityView([D1, D2, D3]);
    assert.equal(view.available, true);
    assert.equal(view.total, 3);
    assert.equal(view.truncated, false);
    assert.equal(view.items.length, 3);

    // Input order is preserved (caller supplies newest-first; the view invents no sort key).
    assert.deepEqual(view.items.map((i) => i.changedEntity), ["card: alpha", "card: beta", "card: gamma"]);

    const first = view.items[0]!;
    assert.equal(first.source, "clickup-adapter");
    assert.equal(first.domain, "ops");
    assert.equal(first.changedEntity, "card: alpha");
    assert.equal(first.actionType, "ops_followup_plan");
    assert.deepEqual(first.affectedAgents, ["Ops Agent", "Fleet Brain"]);
    assert.equal(first.freshness, "live");
    // before→after summary derived from the snapshots.
    assert.match(first.changeSummary, /status: open → done/);
  });

  it("the honest available note describes the order convention", () => {
    const view = recentActivityView([D1]);
    assert.equal(view.available, true);
    assert.match(view.note, /most-recent-first/i);
  });

  it("does not alias the caller's affectedAgents array (read-only invariant)", () => {
    const d = delta({ affectedAgents: ["Ops Agent", "Fleet Brain"] });
    const view = recentActivityView([d]);
    assert.equal(view.available, true);
    if (!view.available) return;
    view.items[0]!.affectedAgents.push("Mutant");
    // The source delta is untouched.
    assert.deepEqual(d.affectedAgents, ["Ops Agent", "Fleet Brain"]);
  });

  it("summarizes a delta with no field-level change honestly", () => {
    const same = delta({ before: { status: "open" }, after: { status: "open" } });
    const view = recentActivityView([same]);
    assert.equal(view.available, true);
    if (!view.available) return;
    assert.match(view.items[0]!.changeSummary, /no field-level change/i);
  });
});

// ─── empty array → available: true, zero items, DISTINCT honest empty-state note ─

describe("recentActivityView — empty feed (distinct from unavailable)", () => {
  it("empty array → available: true, zero items, honest empty-state note", () => {
    const view = recentActivityView([]);
    assert.equal(view.available, true);
    assert.equal(view.total, 0);
    assert.equal(view.items.length, 0);
    assert.equal(view.truncated, false);
    // Distinct from the unavailable note: an empty feed is NOT an unconfigured one.
    assert.match(view.note, /empty feed/i);
    assert.doesNotMatch(view.note, /unavailable/i);
  });
});

// ─── limit cap → truncated: true (honest, no silent drop) ────────────────────────

describe("recentActivityView — limit cap", () => {
  it("caps items at the limit and flags truncated: true (no silent drop)", () => {
    const many = [D1, D2, D3];
    const view = recentActivityView(many, { limit: 2 });
    assert.equal(view.available, true);
    assert.equal(view.total, 3);
    assert.equal(view.items.length, 2);
    assert.equal(view.truncated, true);
    // The note is honest that older deltas are not dropped, just not shown.
    assert.match(view.note, /2 of 3/);
    assert.match(view.note, /not dropped/i);
    // The first `limit` items (newest-first per input) are the ones shown.
    assert.deepEqual(view.items.map((i) => i.changedEntity), ["card: alpha", "card: beta"]);
  });

  it("under the limit → truncated: false", () => {
    const view = recentActivityView([D1, D2], { limit: 5 });
    assert.equal(view.available, true);
    assert.equal(view.truncated, false);
    assert.equal(view.items.length, 2);
  });

  it("limit <= 0 means no cap", () => {
    const view = recentActivityView([D1, D2, D3], { limit: 0 });
    assert.equal(view.available, true);
    assert.equal(view.truncated, false);
    assert.equal(view.items.length, 3);
  });

  it("default cap shows all when under the default", () => {
    const view = recentActivityView([D1, D2, D3]);
    assert.equal(view.available, true);
    assert.equal(view.truncated, false);
    assert.equal(view.items.length, 3);
  });
});

// ─── executable disabled + no execute/secret token in the serialized view ────────

describe("recentActivityView — read-only invariants", () => {
  it("executable is the literal 'disabled' in both branches", () => {
    assert.equal(recentActivityView([D1]).executable, "disabled");
    assert.equal(recentActivityView(null).executable, "disabled");
  });

  it("the serialized view carries no execute method / secret token", () => {
    const json = JSON.stringify(recentActivityView([D1, D2, D3]));
    assert.doesNotMatch(json, /"execute"/i);
    assert.doesNotMatch(json, /secret|token|service[_-]?role|api[_-]?key|password/i);
    // executable is surfaced as the disabled string, never a boolean true.
    assert.doesNotMatch(json, /"executable":true/i);
  });
});

// ─── determinism ─────────────────────────────────────────────────────────────────

describe("recentActivityView — determinism", () => {
  it("same deltas → deep-equal view", () => {
    assert.deepEqual(recentActivityView([D1, D2, D3]), recentActivityView([D1, D2, D3]));
  });

  it("same deltas + same limit → deep-equal view", () => {
    assert.deepEqual(recentActivityView([D1, D2, D3], { limit: 2 }), recentActivityView([D1, D2, D3], { limit: 2 }));
  });

  it("the unavailable view is deterministic too", () => {
    assert.deepEqual(recentActivityView(null), recentActivityView(undefined));
  });
});
