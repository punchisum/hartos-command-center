/**
 * tests/ops-triage-core.test.ts — Ops digest depth upgrade.
 *
 * The deterministic triage core that replaced the panel's first-match count cascade.
 * It ranks ALL fronts by impact then category priority (blocked before urgent even at
 * a lower count — stuck work beats busy work), raises confidence with data breadth,
 * and is honest: a stale ClickUp import becomes a caveat + a confidence cap, and zero
 * card data is insufficient_data, never a fabricated all-clear.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { triageOps, opsSignalsFromSource, summarizeTriage } from "../src/ops/triage-core.js";
import type { SourceResult, SourceValue } from "../src/cockpit/sources/source-types.js";

function srcWith(values: Record<string, string>, freshness: SourceResult["freshness"] = "fresh"): SourceResult {
  const v: Record<string, SourceValue> = {};
  for (const [k, val] of Object.entries(values)) {
    v[k] = { value: val, source: "t", sourceType: "supabase_readonly", lastUpdated: null, freshness, confidence: "high" };
  }
  return {
    name: "ops", sourceType: "supabase_readonly", status: "available", lastUpdated: null, freshness,
    confidence: "high", missingReason: null, setupStep: null, diagnostics: { checked: [], notes: [] }, values: v,
  };
}

describe("ops triage core", () => {
  it("ranks blocked before urgent even when urgent's count is higher", () => {
    const t = triageOps({ urgent: 5, blocked: 1 });
    assert.equal(t.queue[0]!.category, "blocked");
    assert.match(t.primaryAction, /Triage 1 blocked/);
    assert.equal(t.verdict, "urgent");
  });

  it("medium fronts → verdict act", () => {
    const t = triageOps({ waiting: 2 });
    assert.equal(t.verdict, "act");
    assert.match(t.primaryAction, /Unblock 2 card/);
  });

  it("only stale → verdict monitor", () => {
    const t = triageOps({ stale: 4 });
    assert.equal(t.verdict, "monitor");
  });

  it("counts present but all zero → clear, not fabricated", () => {
    const t = triageOps({ activeCards: 12, urgent: 0, blocked: 0 });
    assert.equal(t.verdict, "clear");
    assert.equal(t.queue.length, 0);
  });

  it("no card data at all → insufficient_data (honest), low confidence", () => {
    const t = triageOps({});
    assert.equal(t.verdict, "insufficient_data");
    assert.equal(t.confidence, "low");
  });

  it("risk-flag text becomes a high-severity front", () => {
    const t = triageOps({ riskFlags: "vendor contract expiring" });
    assert.ok(t.queue.some((i) => i.category === "risk" && i.severity === "high"));
    assert.equal(t.verdict, "urgent");
    assert.match(t.primaryAction, /risk flags: vendor contract expiring/);
  });

  it("a stale import is an honest caveat AND caps confidence at medium", () => {
    const t = triageOps({ urgent: 3, blocked: 1, stale: 2, syncStale: true });
    assert.ok(t.caveats.some((c) => /stale/i.test(c)));
    assert.equal(t.confidence, "medium"); // would be high on breadth alone, but the data is suspect
  });

  it("confidence rises with breadth when the import is fresh", () => {
    assert.equal(triageOps({ urgent: 3, blocked: 1, stale: 2 }).confidence, "high");
    assert.equal(triageOps({ urgent: 3 }).confidence, "medium");
  });

  it("totalActionable sums the actionable counts; ranking is full + deterministic", () => {
    const t = triageOps({ blocked: 1, urgent: 1, waiting: 1, stale: 1 });
    assert.equal(t.totalActionable, 4);
    assert.deepEqual(t.queue.map((i) => i.category), ["blocked", "urgent", "waiting", "stale"]);
    assert.deepEqual(triageOps({ blocked: 1, urgent: 1 }), triageOps({ blocked: 1, urgent: 1 }));
    assert.match(summarizeTriage(t), /Ops triage URGENT — 4 front\(s\), 4 card\(s\) actionable\./);
  });

  it("opsSignalsFromSource parses counts and reads sync staleness from freshness", () => {
    const fresh = opsSignalsFromSource(srcWith({ urgent: "3", blocked: "1", active_cards: "12" }, "fresh"));
    assert.equal(fresh.urgent, 3);
    assert.equal(fresh.blocked, 1);
    assert.equal(fresh.syncStale, false);
    const stale = opsSignalsFromSource(srcWith({ urgent: "3" }, "stale"));
    assert.equal(stale.syncStale, true);
    assert.equal(triageOps(stale).confidence, "medium"); // stale ⇒ capped
  });
});
