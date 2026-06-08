/**
 * src/read-models/agent-detail.ts
 *
 * Phase C — per-agent DETAIL read-models. Where the summary read-models
 * (fitness-read-model / ops-read-model) return ONE row per metric for the card
 * overview, these return the rich SERIES + full LISTS a deep dashboard needs:
 * Fitness = recovery + HRV/sleep/bodyweight series + nutrition math + recent
 * workouts; Ops = the full ranked attention list + recent updates + risk flags +
 * status counts.
 *
 * Same boundary as the summaries: a strict read-only SupabaseReadClient (anon key,
 * allowlisted read RPCs only — no mutation possible by construction). Never throws
 * for a single failed RPC; that section degrades to empty + a note. No secrets ever
 * reach a response body (the client sends the key only as a header).
 */

import type { ReadModelStatus } from "./read-model-types.js";
import { SupabaseReadError, type SupabaseReadClient } from "./supabase-read-client.js";

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}
/** Rows from an RPC body shaped as array | {days|points|workouts|items|rows|<key>} | object. */
function rowsFrom(body: unknown, ...keys: string[]): Rec[] {
  if (Array.isArray(body)) return body.filter(isRec);
  if (isRec(body)) {
    for (const key of [...keys, "days", "points", "workouts", "items", "rows"]) {
      const inner = body[key];
      if (Array.isArray(inner)) return inner.filter(isRec);
    }
    return [body];
  }
  return [];
}
function firstRec(body: unknown): Rec | undefined {
  if (Array.isArray(body)) return body.find(isRec);
  return isRec(body) ? body : undefined;
}

interface RpcOutcome {
  reached: boolean;
  status?: number;
  body: unknown;
}
async function callRpc(client: SupabaseReadClient, name: string, args: Rec): Promise<RpcOutcome> {
  try {
    return { reached: true, body: await client.readRpc(name, args) };
  } catch (err) {
    return { reached: false, status: err instanceof SupabaseReadError ? err.status : undefined, body: undefined };
  }
}

export interface SeriesPoint {
  date: string;
  hrvMs?: number;
  restingHr?: number;
  sleepHours?: number;
  bodyweightKg?: number;
}

export interface FitnessDetail {
  type: "fitness";
  status: ReadModelStatus;
  generatedAt: string;
  recovery: { status?: string; hrvMs?: number; restingHr?: number; sleepHours?: number; trainingDayType?: string; workoutCompleted?: boolean };
  /** Per-day recovery/sleep series (newest last), from the weekly summary. */
  series: SeriesPoint[];
  /** Bodyweight weigh-in series (date, kg), from get_fitness_bodyweight_series. */
  bodyweight: Array<{ date: string; kg: number }>;
  nutrition: { caloriesConsumed?: number; caloriesTarget?: number; proteinConsumed?: number; proteinTarget?: number };
  workouts: Array<{ date?: string; type?: string; minutes?: number }>;
  notes: string[];
}

export interface OpsDetail {
  type: "ops";
  status: ReadModelStatus;
  generatedAt: string;
  counts: { active?: number; urgent?: number; blocked?: number; waiting?: number; stale?: number; noNextAction?: number };
  /** The full ranked attention list (not just the top 3 the summary shows). */
  attention: Array<{ title: string; status?: string; reason?: string; nextAction?: string; dueAt?: string; project?: string }>;
  updates: Array<{ cardTitle?: string; summary?: string; updatedBy?: string; updatedAt?: string }>;
  riskFlags: Array<{ flag: string; severity?: string; cardCount?: number }>;
  notes: string[];
}

export type AgentDetail = FitnessDetail | OpsDetail;

/** Fitness detail RPCs (anon-granted; must be allowlisted in the cockpit config). */
export const FITNESS_DETAIL_RPCS = {
  todayState: "get_fitness_today_state",
  weeklySummary: "get_fitness_weekly_summary",
  bodyweightSeries: "get_fitness_bodyweight_series",
  recentWorkouts: "get_fitness_recent_workouts",
} as const;

export async function buildFitnessDetail(
  client: SupabaseReadClient,
  rpcArgs: { userId: string; agentId: string },
  opts: { now?: string } = {},
): Promise<FitnessDetail> {
  const now = opts.now ?? new Date().toISOString();
  const base: Rec = { p_user_id: rpcArgs.userId, p_agent_id: rpcArgs.agentId };
  const notes: string[] = [];
  let reachedAny = false;

  const detail: FitnessDetail = {
    type: "fitness",
    status: "missing",
    generatedAt: now,
    recovery: {},
    series: [],
    bodyweight: [],
    nutrition: {},
    workouts: [],
    notes,
  };

  const today = await callRpc(client, FITNESS_DETAIL_RPCS.todayState, base);
  if (today.reached) {
    reachedAny = true;
    const r = firstRec(today.body);
    if (r) {
      detail.recovery = {
        status: str(r["recovery_status"]) ?? str(r["readiness_status"]),
        hrvMs: num(r["hrv_ms"]),
        restingHr: num(r["resting_hr"]),
        sleepHours: num(r["sleep_hours"]),
        trainingDayType: str(r["training_day_type"]) ?? str(r["today_training_plan"]),
        workoutCompleted: typeof r["workout_completed"] === "boolean" ? (r["workout_completed"] as boolean) : undefined,
      };
      const target = isRec(r["nutrition_target"]) ? (r["nutrition_target"] as Rec) : undefined;
      const remaining = isRec(r["nutrition_remaining"]) ? (r["nutrition_remaining"] as Rec) : undefined;
      detail.nutrition = {
        caloriesConsumed: num(r["calories_consumed"]),
        proteinConsumed: num(r["protein_g"]),
        caloriesTarget: target ? num(target["calories"]) : undefined,
        proteinTarget: target ? (num(target["protein_g"]) ?? num(target["protein"])) : undefined,
      };
      if (detail.nutrition.caloriesTarget === undefined && remaining && detail.nutrition.caloriesConsumed !== undefined) {
        const rem = num(remaining["calories"]);
        if (rem !== undefined) detail.nutrition.caloriesTarget = detail.nutrition.caloriesConsumed + rem;
      }
    }
  } else notes.push("today state unavailable");

  const weekly = await callRpc(client, FITNESS_DETAIL_RPCS.weeklySummary, { ...base, p_days: 14 });
  if (weekly.reached) {
    reachedAny = true;
    // One point per date (the series may carry fragmented duplicate rows).
    const byDate = new Map<string, SeriesPoint>();
    for (const day of rowsFrom(weekly.body)) {
      const date = str(day["state_date"]) ?? str(day["date"]);
      if (!date) continue;
      const key = date.slice(0, 10);
      const p = byDate.get(key) ?? { date: key };
      if (p.hrvMs === undefined) p.hrvMs = num(day["hrv_ms"]);
      if (p.restingHr === undefined) p.restingHr = num(day["resting_hr"]);
      if (p.sleepHours === undefined) p.sleepHours = num(day["sleep_hours"]);
      if (p.bodyweightKg === undefined) p.bodyweightKg = num(day["bodyweight_kg"]);
      byDate.set(key, p);
    }
    detail.series = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  } else notes.push("weekly series unavailable");

  const bw = await callRpc(client, FITNESS_DETAIL_RPCS.bodyweightSeries, { ...base, p_days: 90 });
  if (bw.reached) {
    reachedAny = true;
    for (const point of rowsFrom(bw.body, "points")) {
      const date = str(point["date"]);
      const kg = num(point["bodyweight_kg"] ?? point["kg"]);
      if (date && kg !== undefined) detail.bodyweight.push({ date: date.slice(0, 10), kg });
    }
  } else {
    notes.push("bodyweight series unavailable (apply U-F5 RPC + allowlist it)");
  }

  const workouts = await callRpc(client, FITNESS_DETAIL_RPCS.recentWorkouts, { ...base, p_days: 7 });
  if (workouts.reached) {
    reachedAny = true;
    for (const w of rowsFrom(workouts.body, "workouts")) {
      detail.workouts.push({
        date: (str(w["workout_date"]) ?? str(w["event_date"]) ?? str(w["date"]))?.slice(0, 10),
        type: str(w["workout_type"]) ?? str(w["type"]) ?? str(w["training_day_type"]),
        minutes: num(w["duration_minutes"]) ?? num(w["training_minutes"]),
      });
    }
  } else notes.push("recent workouts unavailable");

  const hasData =
    detail.recovery.status !== undefined ||
    detail.series.length > 0 ||
    detail.bodyweight.length > 0 ||
    detail.workouts.length > 0;
  detail.status = hasData ? (notes.length > 0 ? "degraded" : "ok") : reachedAny ? "missing" : "error";
  return detail;
}

/** Ops detail RPCs (anon-granted; already allowlisted in the cockpit config). */
export const OPS_DETAIL_RPCS = {
  overview: "get_ops_overview",
  attentionCards: "get_ops_attention_cards",
  recentUpdates: "get_ops_recent_updates",
  riskFlags: "get_ops_risk_flags",
} as const;

export async function buildOpsDetail(client: SupabaseReadClient, opts: { now?: string } = {}): Promise<OpsDetail> {
  const now = opts.now ?? new Date().toISOString();
  const notes: string[] = [];
  let reachedAny = false;

  const detail: OpsDetail = {
    type: "ops",
    status: "missing",
    generatedAt: now,
    counts: {},
    attention: [],
    updates: [],
    riskFlags: [],
    notes,
  };

  const overview = await callRpc(client, OPS_DETAIL_RPCS.overview, { p_stale_days: 14 });
  if (overview.reached) {
    reachedAny = true;
    const o = firstRec(overview.body);
    if (o) {
      detail.counts = {
        active: num(o["active_card_count"]),
        urgent: num(o["urgent_card_count"]),
        blocked: num(o["blocked_card_count"]),
        waiting: num(o["waiting_card_count"]),
        stale: num(o["stale_card_count"]),
        noNextAction: num(o["no_next_action_count"]),
      };
    }
  } else notes.push("overview unavailable");

  // The FULL ranked attention list — the deep view, not the top-3 summary.
  const cards = await callRpc(client, OPS_DETAIL_RPCS.attentionCards, { p_stale_days: 14, p_limit: 50 });
  if (cards.reached) {
    reachedAny = true;
    for (const c of rowsFrom(cards.body)) {
      const title = str(c["title"]) ?? str(c["card_title"]);
      if (!title) continue;
      detail.attention.push({
        title,
        status: str(c["status"]),
        reason: str(c["reason_flag"]) ?? str(c["primary_reason"]),
        nextAction: str(c["next_action"]),
        dueAt: str(c["due_at"])?.slice(0, 10),
        project: str(c["project_name"]),
      });
    }
  } else notes.push("attention cards unavailable");

  const updates = await callRpc(client, OPS_DETAIL_RPCS.recentUpdates, { p_limit: 10 });
  if (updates.reached) {
    reachedAny = true;
    for (const u of rowsFrom(updates.body)) {
      detail.updates.push({
        cardTitle: str(u["card_title"]),
        summary: str(u["update_summary"]) ?? str(u["update_text"]),
        updatedBy: str(u["updated_by"]),
        updatedAt: str(u["updated_at"])?.slice(0, 10),
      });
    }
  } else notes.push("recent updates unavailable");

  const risk = await callRpc(client, OPS_DETAIL_RPCS.riskFlags, { p_stale_days: 14 });
  if (risk.reached) {
    reachedAny = true;
    for (const f of rowsFrom(risk.body)) {
      const flag = str(f["flag"]);
      if (!flag) continue;
      detail.riskFlags.push({ flag, severity: str(f["severity"]), cardCount: num(f["card_count"]) });
    }
  } else notes.push("risk flags unavailable");

  const hasData = detail.attention.length > 0 || detail.updates.length > 0 || Object.keys(detail.counts).length > 0;
  detail.status = hasData ? (notes.length > 0 ? "degraded" : "ok") : reachedAny ? "missing" : "error";
  return detail;
}
