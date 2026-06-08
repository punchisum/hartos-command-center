/**
 * tests/suggest-actions.test.ts — "close the loop" synthesis layer.
 *
 * suggestActions distills the live intelligence (forecast / orchestrator / perception
 * / coach / triage) into ONE ranked, de-duplicated "do next" list shaped as cockpit
 * proposal candidates. It drops anything already in the persisted queue, collapses the
 * same action surfaced by two modules, ranks by priority, caps the list, and is
 * propose-only (no writes). Fixtures use the real upstream modules.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { suggestActions, suggestionToProposal } from "../src/cockpit/suggestions/suggest-actions.js";
import { perceive } from "../src/rinnegan/perception.js";
import { forecast } from "../src/prophet/forecast.js";
import { orchestrateFleet } from "../src/fleet/orchestrator.js";
import { collectFleetTasks } from "../src/fleet/fleet-work.js";
import { FLEET_REGISTRY } from "../src/fleet/fleet-os.js";
import type { FreshnessReport } from "../src/cockpit/freshness-surface.js";

const NOW = "2026-06-08T12:00:00Z";
function dom(domain: string, state: string) {
  return { domain, state, lastUpdated: "2026-06-05", reason: "r" };
}
function fresh(domains: ReturnType<typeof dom>[], clickupStale = false): FreshnessReport {
  return { verdict: "amber", verdictReason: "x", domains, clickup: { stale: clickupStale, lastImportAt: null }, staleReason: "", safeNextStep: "x" } as unknown as FreshnessReport;
}

describe("suggest-actions (close the loop)", () => {
  it("turns an orchestrator capability gap into a high-priority build suggestion", () => {
    const noRepair = FLEET_REGISTRY.map((r) => ({ ...r, capabilities: r.capabilities.filter((c) => c !== "repair") }));
    const plan = orchestrateFleet(collectFleetTasks({ perception: perceive({ now: NOW, freshness: fresh([dom("ops", "unavailable")]) }), registry: noRepair }), { registry: noRepair });
    const { actions } = suggestActions({ plan });
    const build = actions.find((a) => a.source === "orchestrator")!;
    assert.equal(build.priority, "high");
    assert.equal(build.actionType, "build_agent_plan");
    assert.match(build.title, /Build an agent for "repair"/);
  });

  it("turns a high-impact forecast consequence into a prevention suggestion", () => {
    const { actions } = suggestActions({ forecast: forecast({ now: NOW, perception: perceive({ now: NOW, freshness: fresh([dom("ops", "stale")]) }) }) });
    assert.ok(actions.some((a) => a.source === "forecast" && a.priority === "high" && /Refresh ops/.test(a.title)));
  });

  it("collapses the same action surfaced by two modules into one (dedup)", () => {
    // ops staleness → perception.recommendation AND forecast.preventedBy are identical.
    const perception = perceive({ now: NOW, freshness: fresh([dom("ops", "stale")]) });
    const { actions } = suggestActions({ perception, forecast: forecast({ now: NOW, perception }) });
    const refreshOps = actions.filter((a) => /Refresh ops/.test(a.title));
    assert.equal(refreshOps.length, 1, "deduped to a single suggestion");
  });

  it("drops suggestions already present in the persisted queue", () => {
    const perception = perceive({ now: NOW, freshness: fresh([dom("ops", "stale")]) });
    const all = suggestActions({ perception });
    const title = all.actions.find((a) => /Refresh ops/.test(a.title))!.title;
    const deduped = suggestActions({ perception, existingTitles: [title] });
    assert.ok(!deduped.actions.some((a) => a.title === title), "already-queued action is not re-suggested");
  });

  it("includes coach + triage actions only when they call for a change", () => {
    const withAct = suggestActions({
      coach: { headline: "Recovery is low — take it easy or rest", priority: "high", act: true },
      triage: { action: "Triage 2 blocked card(s) first.", priority: "high", act: true },
    });
    assert.ok(withAct.actions.some((a) => a.source === "coach" && a.domain === "fitness"));
    assert.ok(withAct.actions.some((a) => a.source === "triage" && a.domain === "ops"));
    const noAct = suggestActions({
      coach: { headline: "Recovery is high — proceed", priority: "low", act: false },
      triage: { action: "No urgent signal", priority: "low", act: false },
    });
    assert.equal(noAct.actions.length, 0);
  });

  it("ranks high priority first and caps the list", () => {
    const perception = perceive({ now: NOW, freshness: fresh([dom("ops", "stale"), dom("fitness", "unavailable"), dom("factory", "stale")], true) });
    const { actions } = suggestActions({ perception, forecast: forecast({ now: NOW, perception }), limit: 3 });
    assert.ok(actions.length <= 3, "respects the cap");
    assert.equal(actions[0]!.priority, "high", "highest priority first");
  });

  it("maps a suggestion into a non-executable draft proposal", () => {
    const perception = perceive({ now: NOW, freshness: fresh([dom("ops", "stale")]) });
    const action = suggestActions({ perception }).actions[0]!;
    const draft = suggestionToProposal(action, NOW);
    assert.equal(draft.status, "draft");
    assert.equal(draft.executable, false);
    assert.equal(draft.requiredApproval, "Hart");
    assert.equal(draft.domain, action.domain);
    assert.equal(draft.actionType, action.actionType);
    assert.equal(draft.title, action.title);
    assert.match(draft.sourceIntent, /^suggested:/);
  });

  it("is honest + deterministic when there is nothing to suggest", () => {
    const empty = suggestActions({});
    assert.deepEqual(empty.actions, []);
    assert.match(empty.note, /No actions to suggest/);
    const perception = perceive({ now: NOW, freshness: fresh([dom("ops", "stale")]) });
    assert.deepEqual(suggestActions({ perception }), suggestActions({ perception }));
  });
});
