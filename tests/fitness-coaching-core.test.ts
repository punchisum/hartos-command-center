/**
 * tests/fitness-coaching-core.test.ts — Fitness coach depth upgrade.
 *
 * The deterministic coaching core that replaced the panel's single-field if/else.
 * It cross-reasons recovery band × planned intensity × completed-status into a
 * grounded verdict, raises confidence with data completeness, names what it can't
 * see, and — the honesty contract — treats unit-ambiguous numbers (weekly load,
 * partial-day calories) as CONTEXT, never as a manufactured readiness inference.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { coach, signalsFromSource, summarizeAdvice } from "../src/fitness/coaching-core.js";
import type { SourceResult, SourceValue } from "../src/cockpit/sources/source-types.js";

function srcWith(values: Record<string, string>): SourceResult {
  const v: Record<string, SourceValue> = {};
  for (const [k, val] of Object.entries(values)) {
    v[k] = { value: val, source: "t", sourceType: "derived", lastUpdated: null, freshness: "fresh", confidence: "high" };
  }
  return {
    name: "fitness", sourceType: "derived", status: "available", lastUpdated: null, freshness: "fresh",
    confidence: "high", missingReason: null, setupStep: null, diagnostics: { checked: [], notes: [] }, values: v,
  };
}

describe("fitness coaching core", () => {
  it("low recovery + hard plan → prioritize recovery (the mismatch is the driver)", () => {
    const a = coach({ recoveryScore: 20, trainingPlan: "hard intervals" });
    assert.equal(a.verdict, "prioritize_recovery");
    assert.equal(a.recoveryBand, "low");
    assert.equal(a.planIntensity, "hard");
    assert.match(a.headline, /swap|rest|mobility|light/i);
    assert.ok(a.drivers.some((d) => /hard/.test(d) && /low/.test(d)) || a.drivers.some((d) => /mismatch/.test(d)));
    assert.equal(a.confidence, "medium"); // recovery known + 1 corroborating (plan)
  });

  it("high recovery + hard plan → train as planned (green light)", () => {
    const a = coach({ recoveryScore: 80, trainingPlan: "hard intervals" });
    assert.equal(a.verdict, "train_as_planned");
    assert.equal(a.recoveryBand, "high");
    assert.match(a.headline, /green light|proceed/i);
  });

  it("moderate recovery + hard plan → train modified (cap it)", () => {
    const a = coach({ recoveryScore: 50, trainingPlan: "threshold tempo" });
    assert.equal(a.verdict, "train_modified");
    assert.equal(a.recoveryBand, "moderate");
    assert.match(a.headline, /cap|cut|20|30|back/i);
  });

  it("moderate recovery + easy plan → proceed (the easy plan fits)", () => {
    const a = coach({ recoveryScore: 50, trainingPlan: "easy zone 2" });
    assert.equal(a.verdict, "train_as_planned");
    assert.equal(a.planIntensity, "easy");
  });

  it("unknown recovery + a plan → conservative default, not fabricated readiness", () => {
    const a = coach({ trainingPlan: "tempo run" });
    assert.equal(a.recoveryBand, "unknown");
    assert.equal(a.verdict, "train_modified");
    assert.match(a.headline, /conservative/i);
    assert.ok(a.drivers.some((d) => /no recovery|defaulting/i.test(d)));
    assert.equal(a.confidence, "low"); // recovery unknown ⇒ low regardless
  });

  it("no signal at all → insufficient_data, honestly", () => {
    const a = coach({});
    assert.equal(a.verdict, "insufficient_data");
    assert.equal(a.confidence, "low");
    assert.ok(a.unknowns.includes("recovery readiness"));
  });

  it("session already completed → recovery focus regardless of band", () => {
    const a = coach({ recoveryScore: 80, trainingCompleted: true, trainingPlan: "hard" });
    assert.equal(a.verdict, "prioritize_recovery");
    assert.match(a.headline, /done|refuel|recovery/i);
    assert.ok(a.drivers.some((d) => /already logged/i.test(d)));
  });

  it("maps qualitative recovery labels (red/amber/green)", () => {
    assert.equal(coach({ recoveryLabel: "red" }).recoveryBand, "low");
    assert.equal(coach({ recoveryLabel: "amber" }).recoveryBand, "moderate");
    assert.equal(coach({ recoveryLabel: "green" }).recoveryBand, "high");
  });

  it("confidence rises with data completeness", () => {
    const lean = coach({ recoveryScore: 80 });
    const rich = coach({ recoveryScore: 80, trainingPlan: "easy", trainingCompleted: false, caloriesHave: 1000, weeklyLoadRaw: "40km" });
    assert.equal(lean.confidence, "low"); // band known but 0 corroborating
    assert.equal(rich.confidence, "high"); // band + 3+ corroborating
  });

  it("treats unit-ambiguous numbers as context, never as a verdict driver", () => {
    const a = coach({ recoveryScore: 80, trainingPlan: "hard", weeklyLoadRaw: "500", caloriesHave: 1200, caloriesTarget: 2400 });
    assert.equal(a.verdict, "train_as_planned"); // nutrition/load did NOT downgrade it
    assert.ok(a.modifiers.some((m) => /partial-day/i.test(m)), "calories flagged partial-day");
    assert.ok(a.modifiers.some((m) => /unit-ambiguous|informational/i.test(m)), "weekly load flagged ambiguous");
  });

  it("surfaces bodyweight trend as context without changing the verdict", () => {
    const a = coach({ recoveryScore: 80, trainingPlan: "hard intervals", bodyweightTrend: "falling" });
    assert.equal(a.verdict, "train_as_planned"); // trend is context, not readiness
    assert.ok(a.modifiers.some((m) => /bodyweight is falling/i.test(m)));
  });

  it("names its blind spots and is deterministic", () => {
    const input = { recoveryScore: 50 };
    const a = coach(input);
    assert.ok(a.unknowns.includes("today's training plan"));
    assert.ok(a.unknowns.includes("nutrition"));
    assert.deepEqual(coach(input), coach(input));
    assert.match(summarizeAdvice(a), /Coach: .* \(moderate recovery, /);
  });

  it("signalsFromSource parses real fitness value shapes", () => {
    const s = signalsFromSource(srcWith({ recovery: "66", calories: "1800 / 2200", protein: "120", training_completed: "yes", training_plan: "easy run", weekly_load: "40 km" }));
    assert.equal(s.recoveryScore, 66);
    assert.equal(s.recoveryLabel, "66");
    assert.equal(s.caloriesHave, 1800);
    assert.equal(s.caloriesTarget, 2200);
    assert.equal(s.proteinHave, 120);
    assert.equal(s.trainingCompleted, true);
    assert.equal(s.trainingPlan, "easy run");
    assert.equal(s.weeklyLoadRaw, "40 km");
    // end-to-end: completed → recovery focus
    assert.equal(coach(s).verdict, "prioritize_recovery");
  });
});
