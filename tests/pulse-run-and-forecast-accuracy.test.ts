/**
 * tests/pulse-run-and-forecast-accuracy.test.ts
 *
 * The pulse-run spine (pure read/write helpers) + the forecast-accuracy scorer. Hermetic.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  coercePulseRunRows,
  mapRowToPulseRun,
  buildPulseRunRow,
  type PulseRun,
} from "../src/cockpit/pulse/pulse-run-spine.js";
import { scoreForecastAccuracy, summarizeForecastAccuracy } from "../src/prophet/forecast-accuracy.js";

describe("pulse-run spine — coerce + map (pure)", () => {
  it("coerces a well-formed RPC body and skips junk", () => {
    const rows = coercePulseRunRows([
      { id: 2, at: "2026-06-10T07:00:00.000Z", verdict: "GREEN", forecast_verdict: "stable", summary: "ok", finding_count: 3, consequence_subjects: ["proposals", "recurring: ops stale"] },
      null,
      42,
      { at: "x" }, // tolerated (id defaults 0); strArray drops nothing here
    ]);
    assert.equal(rows.length, 2, "two object rows survive, primitives dropped");
    assert.equal(rows[0]!.verdict, "GREEN");
    assert.deepEqual(rows[0]!.consequence_subjects, ["proposals", "recurring: ops stale"]);
  });

  it("maps a row to a render summary with honest defaults", () => {
    const m = mapRowToPulseRun({ id: 1, at: "T", verdict: null, forecast_verdict: null, summary: null, finding_count: 0, consequence_subjects: [] });
    assert.equal(m.verdict, "unknown");
    assert.equal(m.forecastVerdict, "unknown");
    assert.equal(m.summary, "");
  });

  it("buildPulseRunRow shapes the write row", () => {
    const row = buildPulseRunRow({
      at: "2026-06-10T07:00:00.000Z",
      verdict: "GREEN",
      forecastVerdict: "degrading",
      summary: "GREEN · forecast degrading",
      findingCount: 2,
      consequenceSubjects: ["proposals"],
    });
    assert.equal(row.forecast_verdict, "degrading");
    assert.deepEqual(row.consequence_subjects, ["proposals"]);
    assert.deepEqual(row.payload, {});
  });
});

function run(at: string, subjects: string[]): PulseRun {
  return { id: Date.parse(at), at, verdict: "GREEN", forecastVerdict: "degrading", summary: "", findingCount: subjects.length, consequenceSubjects: subjects };
}

describe("scoreForecastAccuracy (pure)", () => {
  it("is insufficient_history with fewer than two pulses", () => {
    assert.equal(scoreForecastAccuracy([]).status, "insufficient_history");
    assert.equal(scoreForecastAccuracy([run("2026-06-09T07:00:00.000Z", ["proposals"])]).status, "insufficient_history");
  });

  it("counts persisted vs resolved across consecutive pulses", () => {
    // Older predicted [proposals, ops]; newer still has [proposals] (ops resolved, new 'fitness' appears).
    const older = run("2026-06-09T07:00:00.000Z", ["proposals", "ops"]);
    const newer = run("2026-06-10T07:00:00.000Z", ["proposals", "fitness"]);
    const acc = scoreForecastAccuracy([newer, older]); // unsorted input on purpose
    assert.equal(acc.status, "ok");
    assert.equal(acc.predicted, 2, "older pulse predicted 2 subjects");
    assert.equal(acc.persisted, 1, "proposals persisted");
    assert.equal(acc.resolved, 1, "ops resolved");
    assert.equal(acc.persistenceRate, 0.5);
    assert.match(summarizeForecastAccuracy(acc), /50%/);
  });

  it("is deterministic", () => {
    const a = scoreForecastAccuracy([run("2026-06-09T07:00:00.000Z", ["x"]), run("2026-06-10T07:00:00.000Z", ["x"])]);
    const b = scoreForecastAccuracy([run("2026-06-10T07:00:00.000Z", ["x"]), run("2026-06-09T07:00:00.000Z", ["x"])]);
    assert.deepEqual(a, b);
    assert.equal(a.persistenceRate, 1);
  });
});
