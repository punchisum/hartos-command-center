/**
 * src/cockpit/sources/fitness-source.ts
 *
 * Phase 13B — read-only Fitness source. Resolves fitness fields in priority
 * order: live read-model → local generated report → handover file →
 * unavailable + exact setup step. Never invents values. Async variant does the
 * file I/O; the pure `deriveFitnessSource` uses only in-memory summaries (used
 * as a safe fallback so panel builders stay pure).
 */

import type { AgentIntegrationConfig } from "../../agents/agent-types.js";
import type { ReadModelSummary } from "../../read-models/read-model-types.js";
import type { SourceResult, SourceValue } from "./source-types.js";
import { emptyDiagnostics } from "./source-types.js";
import { layeredResolve, summarizeValues, type SourceLayer } from "./layered.js";
import { findLatestReport, parseKeyValues, pick } from "./local-report-source.js";
import { readHandover } from "./handover-source.js";

export const FITNESS_FIELD_KEYS = [
  "calories", "protein", "training_plan", "training_completed",
  "recovery", "health_freshness", "weekly_load", "latest_workout",
];

const ENABLE_READMODEL_STEP =
  "Enable a fitness read-model in read-models.local.json (mode supabase_readonly) and run `npm run read-models:status`.";

function compose(a?: string | number, b?: string | number): string | undefined {
  if (a == null) return undefined;
  return b == null ? String(a) : `${a} / ${b}`;
}

/** Live (read-model) layer — pure, no I/O. */
function fitnessLiveLayer(rm: ReadModelSummary | undefined): SourceLayer {
  const m = rm?.metrics ?? {};
  const workout = m["latestWorkout"] != null && String(m["latestWorkout"]) !== "none" ? String(m["latestWorkout"]) : undefined;
  return {
    sourceType: "supabase_readonly",
    source: rm ? `supabase:${rm.id}` : "read-model",
    lastUpdated: rm?.dataFreshness ?? null,
    values: {
      recovery: m["recovery"] != null ? String(m["recovery"]) : undefined,
      latest_workout: workout,
      calories: compose(m["caloriesToday"] as string | number | undefined, m["caloriesTarget"] as string | number | undefined) ?? (m["calories"] != null ? String(m["calories"]) : undefined),
      protein: compose(m["proteinToday"] as string | number | undefined, m["proteinTarget"] as string | number | undefined) ?? (m["protein"] != null ? String(m["protein"]) : undefined),
      training_plan: m["trainingPlan"] != null ? String(m["trainingPlan"]) : m["plan"] != null ? String(m["plan"]) : undefined,
      training_completed: m["trainingCompleted"] != null ? String(m["trainingCompleted"]) : m["completed"] != null ? String(m["completed"]) : undefined,
      weekly_load: m["weeklyLoad"] != null ? String(m["weeklyLoad"]) : m["trainingLoad"] != null ? String(m["trainingLoad"]) : m["runningLoad"] != null ? String(m["runningLoad"]) : undefined,
      // Phase 13.6 — prefer explicit HRV/RHR/sleep vitals (from read-only RPCs); fall back to data freshness.
      health_freshness: m["healthVitals"] != null ? String(m["healthVitals"]) : rm && (rm.status === "ok" || rm.status === "degraded") && rm.dataFreshness ? rm.dataFreshness : undefined,
    },
  };
}

function kvLayer(sourceType: SourceLayer["sourceType"], source: string, lastUpdated: string | null, kv: Record<string, string>): SourceLayer {
  return {
    sourceType,
    source,
    lastUpdated,
    values: {
      calories: pick(kv, "calories", "calories today", "calories today / target"),
      protein: pick(kv, "protein", "protein today"),
      training_plan: pick(kv, "training plan", "today's training plan", "plan"),
      training_completed: pick(kv, "training completed", "completed"),
      recovery: pick(kv, "recovery", "recovery state", "recovery score"),
      health_freshness: pick(kv, "hrv", "rhr", "sleep", "hrv / rhr / sleep freshness"),
      weekly_load: pick(kv, "weekly load", "training load", "running load", "weekly running / training load"),
      latest_workout: pick(kv, "latest workout", "workout"),
    },
  };
}

function remainingFrom(combined: SourceValue | undefined, label: string): SourceValue | undefined {
  if (!combined) return undefined;
  const match = combined.value.match(/([\d.]+)\s*\/\s*([\d.]+)/);
  if (!match) return undefined;
  const have = Number(match[1]);
  const target = Number(match[2]);
  if (!Number.isFinite(have) || !Number.isFinite(target)) return undefined;
  return { ...combined, value: `${Math.max(0, target - have)} ${label} remaining` };
}

function finishFitness(values: Record<string, SourceValue>, checked: string[], now: string): SourceResult {
  // Derived: calories/protein remaining.
  const calRem = remainingFrom(values["calories"], "kcal");
  if (calRem) values["calories_remaining"] = calRem;
  const proRem = remainingFrom(values["protein"], "g");
  if (proRem) values["protein_remaining"] = proRem;

  const summary = summarizeValues(values);
  const resolvedCount = Object.keys(values).length;
  const status: SourceResult["status"] = resolvedCount === 0 ? "unavailable" : resolvedCount >= FITNESS_FIELD_KEYS.length ? "available" : "partial";
  const diagnostics = emptyDiagnostics();
  diagnostics.checked.push(...checked);
  diagnostics.notes.push(`resolved ${resolvedCount} fitness field(s)`);

  return {
    name: "fitness",
    sourceType: summary.sourceType,
    status,
    lastUpdated: summary.lastUpdated,
    freshness: summary.freshness,
    confidence: summary.confidence,
    missingReason: status === "unavailable" ? "No live read-model, report, or handover provided fitness data." : null,
    setupStep: status === "available" ? null : ENABLE_READMODEL_STEP,
    diagnostics,
    values,
  };
}

/** Pure fallback — read-model summary only, no file I/O. */
export function deriveFitnessSource(rm: ReadModelSummary | undefined, now: string): SourceResult {
  const values = layeredResolve(FITNESS_FIELD_KEYS, [fitnessLiveLayer(rm)], now);
  return finishFitness(values, ["read-model"], now);
}

export interface FitnessSourceOptions {
  cwd: string;
  now: string;
  rm?: ReadModelSummary;
  agentConfig?: AgentIntegrationConfig;
  reportDirs?: string[];
}

/** Full resolution: read-model → local report → handover → unavailable. */
export async function resolveFitnessSource(options: FitnessSourceOptions): Promise<SourceResult> {
  const { cwd, now, rm, agentConfig } = options;
  const checked: string[] = ["read-model"];
  const layers: SourceLayer[] = [fitnessLiveLayer(rm)];

  const dirs = [agentConfig?.reportsPath, "fitness-reports", "agent-reports"].filter((d): d is string => !!d);
  if (dirs.length) {
    const report = await findLatestReport(cwd, dirs, /fitness|recovery|training|workout|brief/i);
    checked.push("local-report");
    if (report) layers.push(kvLayer("local_report", report.relativePath, report.lastUpdated, parseKeyValues(report.content)));
  }

  const handover = await readHandover(cwd, agentConfig?.handoverPath);
  checked.push("handover");
  if (handover) layers.push(kvLayer("handover", handover.relativePath, handover.lastUpdated, handover.keyValues));

  const values = layeredResolve(FITNESS_FIELD_KEYS, layers, now);
  return finishFitness(values, checked, now);
}
