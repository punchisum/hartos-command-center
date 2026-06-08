/**
 * src/read-models/fitness-read-model.ts
 *
 * Summarizes Fitness data through the read-only Supabase boundary.
 *
 * Phase 13.6 — RPC-backed reads. When `allowedRpcs` is configured the adapter
 * PREFERS the agent's existing read-only RPCs (get_fitness_today_state /
 * _today_nutrition / _recent_workouts / _weekly_summary) over table selects,
 * because the Fitness repo exposes its safe read surface as RPCs, not tables.
 * It calls `client.readRpc()` ONLY for names the config allowlists — anything
 * else fails closed inside the client. When no RPCs are allowlisted it falls
 * back to the original allowlisted table-select path. No mutation is possible;
 * service-role keys are rejected upstream. Errors never expose secret values
 * (only the RPC name + HTTP status are surfaced).
 */

import type {
  FitnessRpcStatus,
  ReadModelAvailability,
  ReadModelConfig,
  ReadModelSummary,
} from "./read-model-types.js";
import { SupabaseReadError, type SupabaseReadClient } from "./supabase-read-client.js";

/** Known read-only Fitness RPCs (must be allowlisted in config to be called). */
export const FITNESS_RPCS = {
  todayState: "get_fitness_today_state",
  todayNutrition: "get_fitness_today_nutrition",
  recentWorkouts: "get_fitness_recent_workouts",
  weeklySummary: "get_fitness_weekly_summary",
} as const;

/**
 * Resolved RPC args (values may be undefined). The env var NAMES are carried so
 * a precise "set X" setup step can be produced without ever printing a value.
 */
export interface FitnessRpcArgs {
  userId?: string;
  agentId?: string;
  userIdEnv?: string;
  agentIdEnv?: string;
}

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** First usable record from a PostgREST RPC body (array | {rows|items|workouts} | object). */
function firstRecord(body: unknown): Rec | undefined {
  if (Array.isArray(body)) return body.find(isRec);
  if (isRec(body)) {
    for (const key of ["items", "workouts", "rows"]) {
      const inner = body[key];
      if (Array.isArray(inner)) return inner.find(isRec);
    }
    return body;
  }
  return undefined;
}

function allRecords(body: unknown): Rec[] {
  if (Array.isArray(body)) return body.filter(isRec);
  if (isRec(body)) {
    for (const key of ["items", "workouts", "rows"]) {
      const inner = body[key];
      if (Array.isArray(inner)) return inner.filter(isRec);
    }
    return [body];
  }
  return [];
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}
function pickNum(rec: Rec, ...keys: string[]): number | undefined {
  for (const k of keys) { const n = num(rec[k]); if (n != null) return n; }
  return undefined;
}
function pickStr(rec: Rec, ...keys: string[]): string | undefined {
  for (const k of keys) { const s = str(rec[k]); if (s != null) return s; }
  return undefined;
}
function compact(parts: Array<string | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(", ");
}

interface RpcOutcome {
  /** Reachable (HTTP 200) — body may still be empty. */
  reached: boolean;
  /** HTTP status on failure, if any. */
  status?: number;
  /** Records parsed from a reachable response. */
  records: Rec[];
}

/** Call one allowlisted RPC, classifying the outcome. Never throws. */
async function callRpc(client: SupabaseReadClient, name: string, args: Rec): Promise<RpcOutcome> {
  try {
    const body = await client.readRpc(name, args);
    return { reached: true, records: allRecords(body) };
  } catch (err) {
    const status = err instanceof SupabaseReadError ? err.status : undefined;
    return { reached: false, status, records: [] };
  }
}

function worstRpcStatus(statuses: Array<number | undefined>): FitnessRpcStatus {
  if (statuses.some((s) => s === 403)) return "rpc_forbidden";
  if (statuses.some((s) => s === 404)) return "rpc_unavailable";
  if (statuses.some((s) => s === 400 || s === 422)) return "rpc_shape_mismatch";
  return "rpc_unavailable";
}

function setupStepFor(rpcStatus: FitnessRpcStatus, args: FitnessRpcArgs): string {
  switch (rpcStatus) {
    case "rpc_missing_env":
      return `Set ${args.userIdEnv ?? "HARTOS_USER_ID"} and ${args.agentIdEnv ?? "HARTOS_AGENT_ID"} in .env.local (the fitness user/agent id, read-only) and run \`npm run read-models:status\`.`;
    case "rpc_forbidden":
      return "Grant EXECUTE on the read-only fitness RPCs to the anon role (read-only), or expose them via a SECURITY DEFINER read function.";
    case "rpc_unavailable":
      return "Deploy/expose the read-only fitness RPCs (get_fitness_today_state / _today_nutrition / _recent_workouts / _weekly_summary) in the fitness Supabase project.";
    case "rpc_shape_mismatch":
      return "The fitness RPC returned an unexpected shape — verify the RPC arg names (p_user_id/p_agent_id) and response columns.";
    case "rpc_no_rows":
      return "RPCs are reachable but returned no rows — confirm the configured fitness user/agent id has data.";
    default:
      return "Read-only; review in the cockpit.";
  }
}

function summary(
  config: ReadModelConfig,
  fields: {
    status: ReadModelSummary["status"];
    confidence: ReadModelSummary["confidence"];
    lines: string[];
    metrics: Record<string, string | number>;
    recommendation: string;
    dataFreshness: string | null;
    degradedSources: string[];
    rpcStatus?: FitnessRpcStatus;
  }
): ReadModelSummary {
  return { id: config.id, type: "fitness", ...fields };
}

/** RPC-backed path — preferred when allowedRpcs is configured. */
async function buildFromRpcs(
  config: ReadModelConfig,
  client: SupabaseReadClient,
  rpcArgs: FitnessRpcArgs
): Promise<ReadModelSummary> {
  // RPC args are required for per-user fitness reads. Without them we cannot
  // safely call the RPC, so report the exact env to set (never the value).
  if (!rpcArgs.userId || !rpcArgs.agentId) {
    return summary(config, {
      status: "missing",
      confidence: "low",
      lines: ["Fitness RPCs are allowlisted but the user/agent id args are not set."],
      metrics: {},
      recommendation: setupStepFor("rpc_missing_env", rpcArgs),
      dataFreshness: null,
      degradedSources: [],
      rpcStatus: "rpc_missing_env",
    });
  }

  const base: Rec = { p_user_id: rpcArgs.userId, p_agent_id: rpcArgs.agentId };
  const metrics: Record<string, string | number> = {};
  const lines: string[] = [];
  const degradedSources: string[] = [];
  const failures: Array<number | undefined> = [];
  let reachedAny = false;
  let dataFreshness: string | null = null;

  const wanted: Array<{ name: string; args: Rec }> = [
    { name: FITNESS_RPCS.todayState, args: base },
    { name: FITNESS_RPCS.todayNutrition, args: { ...base, p_event_date: null } },
    { name: FITNESS_RPCS.recentWorkouts, args: { ...base, p_days: 7 } },
    { name: FITNESS_RPCS.weeklySummary, args: { ...base, p_days: 7 } },
  ];

  for (const { name, args } of wanted) {
    if (!config.allowedRpcs.includes(name)) {
      degradedSources.push(name);
      continue;
    }
    const outcome = await callRpc(client, name, args);
    if (!outcome.reached) {
      failures.push(outcome.status);
      degradedSources.push(name);
      continue;
    }
    reachedAny = true;

    if (name === FITNESS_RPCS.todayState) {
      const r = firstRecord(outcome.records);
      if (r) {
        const recovery = pickStr(r, "recovery_status", "readiness_status", "recovery_score", "recovery");
        if (recovery != null) metrics["recovery"] = recovery;
        // Fail loudly on shape drift: today_state resolved but the headline recovery
        // field is absent (the stale-snapshot cause of the cockpit "UNKNOWN on fresh
        // data" bug). Mark it degraded so the cockpit shows *why* the verdict is idle.
        else degradedSources.push("recovery (today_state returned no recovery_status/score — RPC shape drift)");
        const vitals = compact([
          pickNum(r, "hrv_ms") != null ? `HRV ${pickNum(r, "hrv_ms")}ms` : undefined,
          pickNum(r, "resting_hr") != null ? `RHR ${pickNum(r, "resting_hr")} bpm` : undefined,
          pickNum(r, "sleep_hours") != null ? `sleep ${pickNum(r, "sleep_hours")}h` : undefined,
        ]);
        if (vitals) metrics["healthVitals"] = vitals;
        const plan = pickStr(r, "training_day_type", "training_status", "workout_status");
        if (plan != null) metrics["trainingPlan"] = plan;
        if (typeof r["workout_completed"] === "boolean") metrics["trainingCompleted"] = r["workout_completed"] ? "yes" : "no";
        const load = pickNum(r, "training_load");
        if (load != null && metrics["weeklyLoad"] == null) metrics["weeklyLoad"] = `load ${load}`;
        // Nutrition fallback from today_state if the nutrition RPC is absent.
        const cal = pickNum(r, "calories_consumed");
        if (cal != null && metrics["caloriesToday"] == null) metrics["caloriesToday"] = cal;
        const pro = pickNum(r, "protein_g");
        if (pro != null && metrics["proteinToday"] == null) metrics["proteinToday"] = pro;
        dataFreshness =
          pickStr(r, "health_updated_at", "nutrition_updated_at", "workout_updated_at", "state_date", "today_date", "date", "local_date") ?? dataFreshness;
        lines.push("Today state resolved (read-only RPC).");
      }
    } else if (name === FITNESS_RPCS.todayNutrition) {
      const r = firstRecord(outcome.records);
      if (r) {
        const totals = isRec(r["logged_active_totals"]) ? (r["logged_active_totals"] as Rec) : r;
        const target = isRec(r["target"]) ? (r["target"] as Rec) : isRec(r["nutrition_target"]) ? (r["nutrition_target"] as Rec) : undefined;
        const remaining = isRec(r["remaining"]) ? (r["remaining"] as Rec) : isRec(r["nutrition_remaining"]) ? (r["nutrition_remaining"] as Rec) : undefined;
        const calToday = pickNum(totals, "calories_consumed", "calories");
        const proToday = pickNum(totals, "protein_g", "protein");
        if (calToday != null) metrics["caloriesToday"] = calToday;
        if (proToday != null) metrics["proteinToday"] = proToday;
        let calTarget = target ? pickNum(target, "calories") : undefined;
        let proTarget = target ? pickNum(target, "protein_g", "protein") : undefined;
        const calRem = remaining ? pickNum(remaining, "calories") : undefined;
        const proRem = remaining ? pickNum(remaining, "protein_g", "protein") : undefined;
        // Derive target from consumed + remaining when target not provided, so
        // the panel can compose "today / target" and derive remaining.
        if (calTarget == null && calToday != null && calRem != null) calTarget = calToday + calRem;
        if (proTarget == null && proToday != null && proRem != null) proTarget = proToday + proRem;
        if (calTarget != null) metrics["caloriesTarget"] = calTarget;
        if (proTarget != null) metrics["proteinTarget"] = proTarget;
        dataFreshness = pickStr(r, "event_date", "state_date", "date") ?? dataFreshness;
        lines.push("Today nutrition resolved (read-only RPC).");
      }
    } else if (name === FITNESS_RPCS.recentWorkouts) {
      const r = firstRecord(outcome.records);
      if (r) {
        const type = pickStr(r, "workout_type", "type", "training_day_type") ?? "workout";
        const date = pickStr(r, "workout_date", "event_date", "started_at", "date");
        metrics["latestWorkout"] = date ? `${type} (${date.slice(0, 10)})` : type;
        lines.push("Recent workouts resolved (read-only RPC).");
      }
    } else if (name === FITNESS_RPCS.weeklySummary) {
      const r = firstRecord(outcome.records);
      if (r) {
        const workouts = pickNum(r, "total_workouts", "workout_count", "workouts_count", "completed_workouts");
        const minutes = pickNum(r, "training_minutes", "total_training_minutes");
        const steps = pickNum(r, "steps", "total_steps", "average_steps");
        const load = compact([
          workouts != null ? `${workouts} workouts` : undefined,
          minutes != null ? `${minutes} min` : undefined,
          steps != null ? `${steps} steps` : undefined,
        ]);
        if (load) metrics["weeklyLoad"] = load;
        // Enrich vitals from weekly averages if today_state didn't provide them.
        if (metrics["healthVitals"] == null) {
          const wv = compact([
            pickNum(r, "average_hrv_ms") != null ? `HRV ${pickNum(r, "average_hrv_ms")}ms avg` : undefined,
            pickNum(r, "average_resting_hr") != null ? `RHR ${pickNum(r, "average_resting_hr")} bpm avg` : undefined,
          ]);
          if (wv) metrics["healthVitals"] = wv;
        }
        lines.push("Weekly summary resolved (read-only RPC).");
      }
    }
  }

  const hasData = Object.keys(metrics).length > 0;

  // No usable data resolved — classify precisely.
  if (!hasData) {
    if (!reachedAny && failures.length > 0) {
      const rpcStatus = worstRpcStatus(failures);
      return summary(config, {
        status: "error",
        confidence: "low",
        lines: [`Fitness RPCs unavailable (status ${failures.map((s) => s ?? "n/a").join(", ")}).`],
        metrics: {},
        recommendation: setupStepFor(rpcStatus, rpcArgs),
        dataFreshness: null,
        degradedSources,
        rpcStatus,
      });
    }
    // Reached but empty (or nothing allowlisted to call).
    const rpcStatus: FitnessRpcStatus = reachedAny ? "rpc_no_rows" : "rpc_unavailable";
    return summary(config, {
      status: "missing",
      confidence: "low",
      lines: [reachedAny ? "Fitness RPCs reachable but returned no rows." : "No known fitness RPCs are allowlisted."],
      metrics: {},
      recommendation: setupStepFor(rpcStatus, rpcArgs),
      dataFreshness: null,
      degradedSources,
      rpcStatus,
    });
  }

  // Some data resolved. Degraded if any wanted RPC failed or was not allowlisted.
  const degraded = degradedSources.length > 0;
  return summary(config, {
    status: degraded ? "degraded" : "ok",
    confidence: degraded ? "medium" : "high",
    lines: lines.length ? lines : ["Fitness read-only RPC data resolved."],
    metrics,
    recommendation: "Read-only; review in the cockpit.",
    dataFreshness,
    degradedSources,
    rpcStatus: "rpc_live",
  });
}

/** Table-backed path — preserved fallback when no RPCs are allowlisted. */
async function buildFromTables(
  config: ReadModelConfig,
  client: SupabaseReadClient
): Promise<ReadModelSummary> {
  const degradedSources: string[] = [];
  const metrics: Record<string, string | number> = {};
  const lines: string[] = [];
  let dataFreshness: string | null = null;

  try {
    if (config.allowedTables.includes("derived_latest_state")) {
      const latest = (await client.select("derived_latest_state", { limit: 1 }))[0];
      if (latest) {
        if (latest["recovery"] != null) { metrics["recovery"] = String(latest["recovery"]); lines.push(`Latest recovery: ${String(latest["recovery"])}.`); }
        dataFreshness = String(latest["updated_at"] ?? latest["date"] ?? "") || null;
      }
    } else {
      degradedSources.push("derived_latest_state");
    }
    if (config.allowedTables.includes("derived_daily_state")) {
      const daily = await client.select("derived_daily_state", { limit: 1, order: "date" });
      if (daily[0]) lines.push(`Latest daily state: ${String(daily[0]["summary"] ?? daily[0]["date"] ?? "available")}.`);
    }
    if (config.allowedTables.includes("canonical_workouts")) {
      const workouts = await client.select("canonical_workouts", { limit: 1, order: "date" });
      metrics["latestWorkout"] = workouts[0] ? String(workouts[0]["type"] ?? "workout") : "none";
      if (workouts[0]) lines.push(`Latest workout: ${String(workouts[0]["type"] ?? "workout")}.`);
    }
    if (config.allowedTables.includes("canonical_health")) {
      const health = await client.select("canonical_health", { limit: 1, order: "date" });
      if (health[0]) lines.push(`Latest health row date: ${String(health[0]["date"] ?? "available")}.`);
    }
  } catch (err) {
    return summary(config, {
      status: "error",
      confidence: "low",
      lines: [`Fitness read failed: ${(err as Error).message}`],
      metrics,
      recommendation: "Check the read-only Supabase boundary configuration.",
      dataFreshness,
      degradedSources,
    });
  }

  return summary(config, {
    status: degradedSources.length > 0 ? "degraded" : "ok",
    confidence: degradedSources.length > 0 ? "medium" : "high",
    lines: lines.length > 0 ? lines : ["No rows returned from allowlisted fitness tables."],
    metrics,
    recommendation: "Read-only; review in the cockpit.",
    dataFreshness,
    degradedSources,
  });
}

export async function buildFitnessReadModelSummary(
  config: ReadModelConfig,
  availability: ReadModelAvailability,
  client?: SupabaseReadClient,
  rpcArgs: FitnessRpcArgs = {}
): Promise<ReadModelSummary> {
  if (!config.enabled) {
    return summary(config, {
      status: "disabled",
      confidence: "low",
      lines: ["Fitness read model is disabled. Set enabled=true in read-models.local.json to connect real data."],
      metrics: {},
      recommendation: "Enable this read model and set the configured env vars.",
      dataFreshness: null,
      degradedSources: [],
    });
  }
  if (!availability.envPresent || !client) {
    const rpcMode = config.allowedRpcs.length > 0;
    return summary(config, {
      status: "missing",
      confidence: "low",
      lines: [`Fitness read model enabled but env/client missing: ${availability.missingEnv.join(", ") || "no client"}.`],
      metrics: {},
      recommendation: "Set the Supabase URL + read-only key env vars.",
      dataFreshness: null,
      degradedSources: availability.missingEnv,
      ...(rpcMode ? { rpcStatus: "rpc_missing_env" as FitnessRpcStatus } : {}),
    });
  }

  // Phase 13.6 — prefer the read-only RPC surface when allowlisted.
  if (config.allowedRpcs.length > 0) {
    return buildFromRpcs(config, client, rpcArgs);
  }
  return buildFromTables(config, client);
}
