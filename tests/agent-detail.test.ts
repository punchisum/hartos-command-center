/**
 * tests/agent-detail.test.ts — Phase C.
 * The per-agent DETAIL read-models return rich series + full lists from the
 * read-only RPC boundary; a failing RPC degrades that section honestly (empty +
 * note), never fabricated, and no key ever reaches a response.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFitnessDetail, buildOpsDetail, FITNESS_DETAIL_RPCS, OPS_DETAIL_RPCS } from "../src/read-models/agent-detail.js";
import { SupabaseReadClient, type FetchLike } from "../src/read-models/supabase-read-client.js";

const ANON_KEY = "anon-read-only-key";

const FIXTURES: Record<string, unknown> = {
  get_fitness_today_state: {
    state_date: "2026-06-07",
    recovery_status: "green",
    hrv_ms: 55,
    resting_hr: 52,
    sleep_hours: 8,
    training_day_type: "interval_run",
    workout_completed: false,
    calories_consumed: 1200,
    protein_g: 90,
    nutrition_target: { calories: 3100, protein_g: 180 },
  },
  get_fitness_weekly_summary: {
    average_hrv_ms: 50,
    days: [
      { state_date: "2026-06-06", hrv_ms: 55, resting_hr: 52, sleep_hours: 8 },
      { state_date: "2026-06-05", hrv_ms: 52, resting_hr: 54, sleep_hours: 7.5, bodyweight_kg: 80.2 },
    ],
  },
  get_fitness_bodyweight_series: {
    points: [
      { date: "2026-06-05", bodyweight_kg: 80.2 },
      { date: "2026-06-06", bodyweight_kg: 80.0 },
    ],
  },
  get_fitness_recent_workouts: { workouts: [{ workout_date: "2026-06-06", workout_type: "zone2_run", duration_minutes: 45 }] },
  get_ops_overview: {
    active_card_count: 5,
    urgent_card_count: 2,
    blocked_card_count: 1,
    waiting_card_count: 0,
    stale_card_count: 3,
    no_next_action_count: 1,
  },
  get_ops_attention_cards: [
    { title: "Wire to supplier", status: "URGENT", reason_flag: "urgent", next_action: "send", due_at: "2026-06-01T00:00:00Z", project_name: "Finance" },
    { title: "Renewal soon", status: "ACTIVE", reason_flag: "cooling", next_action: "renew" },
  ],
  get_ops_recent_updates: [{ card_title: "Wire to supplier", update_summary: "chased the bank", updated_by: "hart", updated_at: "2026-06-06T09:00:00Z" }],
  get_ops_risk_flags: [{ flag: "overdue", severity: "high", card_count: 2 }],
};

/** A read client whose fetch routes by RPC name to a fixture; `failing` 404s. */
function clientWith(failing: Set<string> = new Set()): SupabaseReadClient {
  const fetch: FetchLike = async (url) => {
    const name = /\/rpc\/([a-z0-9_]+)/.exec(String(url))?.[1] ?? "";
    if (failing.has(name)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => FIXTURES[name] ?? [] };
  };
  return new SupabaseReadClient(
    {
      url: "https://x.supabase.co",
      key: ANON_KEY,
      allowedTables: [],
      allowedRpcs: [...Object.values(FITNESS_DETAIL_RPCS), ...Object.values(OPS_DETAIL_RPCS)],
    },
    fetch,
  );
}

const ARGS = { userId: "11111111-1111-1111-1111-111111111111", agentId: "22222222-2222-2222-2222-222222222222" };
const NOW = "2026-06-07T08:00:00.000Z";

describe("fitness detail read-model", () => {
  it("returns recovery + series + bodyweight + nutrition + workouts", async () => {
    const d = await buildFitnessDetail(clientWith(), ARGS, { now: NOW });
    assert.equal(d.type, "fitness");
    assert.equal(d.status, "ok");
    assert.equal(d.recovery.status, "green");
    assert.equal(d.recovery.hrvMs, 55);
    // Series is per-date, sorted ascending (dedup of the fragmented rows).
    assert.deepEqual(d.series.map((p) => p.date), ["2026-06-05", "2026-06-06"]);
    assert.equal(d.series[1]!.sleepHours, 8);
    assert.equal(d.bodyweight.length, 2);
    assert.equal(d.bodyweight[1]!.kg, 80.0);
    assert.equal(d.nutrition.caloriesTarget, 3100);
    assert.equal(d.nutrition.proteinTarget, 180);
    assert.equal(d.workouts.length, 1);
    assert.equal(d.workouts[0]!.type, "zone2_run");
  });

  it("degrades honestly when a detail RPC is unavailable", async () => {
    const d = await buildFitnessDetail(clientWith(new Set(["get_fitness_bodyweight_series"])), ARGS, { now: NOW });
    assert.equal(d.bodyweight.length, 0);
    assert.equal(d.status, "degraded");
    assert.match(d.notes.join(" "), /bodyweight series unavailable/);
    // The rest still resolved.
    assert.equal(d.recovery.status, "green");
    assert.ok(d.series.length > 0);
  });
});

describe("ops detail read-model", () => {
  it("returns the FULL attention list + counts + updates + risk flags", async () => {
    const d = await buildOpsDetail(clientWith(), { now: NOW });
    assert.equal(d.type, "ops");
    assert.equal(d.status, "ok");
    assert.equal(d.counts.urgent, 2);
    assert.equal(d.attention.length, 2);
    assert.equal(d.attention[0]!.title, "Wire to supplier");
    assert.equal(d.attention[0]!.reason, "urgent");
    assert.equal(d.attention[0]!.dueAt, "2026-06-01");
    assert.equal(d.updates.length, 1);
    assert.equal(d.updates[0]!.summary, "chased the bank");
    assert.equal(d.riskFlags[0]!.flag, "overdue");
  });

  it("never leaks the read-only key into the detail object", async () => {
    const d = await buildOpsDetail(clientWith(), { now: NOW });
    assert.equal(JSON.stringify(d).includes(ANON_KEY), false);
  });
});
