/**
 * src/cockpit/panels/fitness-panel.ts
 *
 * Phase 12A panel, upgraded for Phase 13B. Pure function of PanelInputs. It maps
 * a resolved read-only Fitness SourceResult (live read-model → local report →
 * handover, with freshness/confidence) onto panel fields. When no resolved
 * source is supplied it derives one from the in-memory read-model summary, so
 * the builder stays pure and Phase 12 behavior is preserved.
 */

import type { AgentReadModel } from "../../agents/agent-types.js";
import type { ReadModelSummary } from "../../read-models/read-model-types.js";
import type { SourceResult } from "../sources/source-types.js";
import { deriveFitnessSource } from "../sources/fitness-source.js";
import type { DomainPanel, DomainPanelStatus, PanelField, PanelFieldStatus } from "./panel-types.js";
import { okField, unavailableField, fieldFromSource } from "./panel-types.js";
import type { PanelInputs } from "./panel-inputs.js";

const NUTRITION_STEP =
  "Expose a daily nutrition table (calories/protein vs target) in the fitness read-model allowedTables, then run `npm run read-models:status`.";
const HEALTH_STEP =
  "Allowlist `canonical_health` (HRV/RHR/sleep) in the fitness read-model, then run `npm run read-models:status`.";
const LOAD_STEP =
  "Expose weekly training/running load (e.g. derived_daily_state) in the fitness read-model allowedTables.";
const PLAN_STEP =
  "Publish today's plan to the fitness agent reports/handover, or expose it in the read-model.";
const ENABLE_READMODEL_STEP =
  "Enable a fitness read-model in read-models.local.json (mode supabase_readonly) and run `npm run read-models:status`.";
const CONFIGURE_AGENT_STEP =
  "Configure a fitness agent in agent-integrations.local.json (repoPath/reportsPath/handoverPath) and run `npm run agents:status`.";

// Phase 13.6B — RPC-aware per-field hints. Used when the Fitness read-model is
// RPC-backed (the agent exposes read-only RPCs, not tables), so we never tell
// Hart to "expose a table" or "enable a read-model" that already exists.
const RPC_NUTRITION_CAL =
  "Update `get_fitness_today_nutrition` to return calorie target and remaining fields, then run `npm run read-models:status`.";
const RPC_NUTRITION_PRO =
  "Update `get_fitness_today_nutrition` to return protein target and remaining fields.";
const RPC_STATE_RECOVERY =
  "Update `get_fitness_today_state` to return recovery, HRV, RHR, and sleep fields.";
const RPC_STATE_PLAN =
  "Update `get_fitness_today_state` to return today's training plan.";
const RPC_STATE_COMPLETED =
  "Update `get_fitness_today_state` to return today's training completed status.";
const RPC_WORKOUTS =
  "`get_fitness_recent_workouts` returned no recent workout row, or the adapter could not map it.";
const RPC_WEEKLY =
  "Update `get_fitness_weekly_summary` to return weekly load/training volume fields.";

interface FieldSpec { key: string; label: string; setupStep: string; rpcStep: string; }

const FITNESS_SPECS: FieldSpec[] = [
  { key: "calories", label: "Calories today / target", setupStep: NUTRITION_STEP, rpcStep: RPC_NUTRITION_CAL },
  { key: "calories_remaining", label: "Calories remaining", setupStep: NUTRITION_STEP, rpcStep: RPC_NUTRITION_CAL },
  { key: "protein", label: "Protein today / target", setupStep: NUTRITION_STEP, rpcStep: RPC_NUTRITION_PRO },
  { key: "protein_remaining", label: "Protein remaining", setupStep: NUTRITION_STEP, rpcStep: RPC_NUTRITION_PRO },
  { key: "training_plan", label: "Today's training plan", setupStep: PLAN_STEP, rpcStep: RPC_STATE_PLAN },
  { key: "training_completed", label: "Training completed", setupStep: ENABLE_READMODEL_STEP, rpcStep: RPC_STATE_COMPLETED },
  { key: "recovery", label: "Recovery state", setupStep: ENABLE_READMODEL_STEP, rpcStep: RPC_STATE_RECOVERY },
  { key: "health_freshness", label: "HRV / RHR / sleep freshness", setupStep: HEALTH_STEP, rpcStep: RPC_STATE_RECOVERY },
  { key: "weekly_load", label: "Weekly running / training load", setupStep: LOAD_STEP, rpcStep: RPC_WEEKLY },
  { key: "latest_workout", label: "Latest workout", setupStep: ENABLE_READMODEL_STEP, rpcStep: RPC_WORKOUTS },
];

export function buildFitnessPanel(inputs: PanelInputs): DomainPanel {
  const agent: AgentReadModel | undefined = inputs.agentIntegration.agents.find((a) => a.agentType === "fitness");
  const rm: ReadModelSummary | undefined = inputs.readModels.summaries.find((s) => s.type === "fitness");
  const src: SourceResult = inputs.sources?.fitness ?? deriveFitnessSource(rm, inputs.now);

  const agentConfigured = !!agent;
  const rmPresent = !!rm;
  const anyConfig = agentConfigured || rmPresent;
  const rmLive = !!rm && (rm.status === "ok" || rm.status === "degraded");
  const agentDetected = !!agent && (agent.status === "ok" || agent.status === "degraded");

  const sources: string[] = [];
  if (agent) sources.push("agent-integrations.local.json");
  if (rm) sources.push("read-models.local.json (fitness)");
  if (src.diagnostics.checked.length) sources.push(...src.diagnostics.checked.map((c) => `source:${c}`));

  const fields: PanelField[] = [];
  const highlights: string[] = [];
  const gaps: string[] = [];
  const setup = new Set<string>();

  // ── configured / detected status ──
  const detected = agentDetected || rmLive || src.status !== "unavailable";
  const configuredValue = !anyConfig ? "not configured" : detected ? "detected" : "configured (no live data yet)";
  fields.push(okField("status", "Configured / detected", configuredValue, { source: sources.join(", ") || "none", confidence: detected ? "high" : "low" }));

  // ── data fields from the resolved source ──
  // Phase 13.6B — when the fitness read-model is RPC-backed (rpcStatus is set,
  // regardless of live/missing), missing fields get RPC-specific hints instead
  // of stale table/read-model setup steps.
  const rpcBacked = !!rm?.rpcStatus;
  for (const spec of FITNESS_SPECS) {
    const sv = src.values[spec.key];
    if (sv) {
      fields.push(fieldFromSource(spec.key, spec.label, sv));
    } else {
      const status: Exclude<PanelFieldStatus, "ok"> = anyConfig ? "no_data" : "not_configured";
      const step = rpcBacked ? spec.rpcStep : spec.setupStep;
      fields.push(unavailableField(spec.key, spec.label, status, step, rpcBacked ? "fitness read-only RPCs" : "fitness read-model / reports"));
      setup.add(step);
    }
  }

  // Highlights from real values.
  if (src.values["recovery"]) highlights.push(`Recovery: ${src.values["recovery"]!.value}.`);
  if (src.values["latest_workout"]) highlights.push(`Latest workout: ${src.values["latest_workout"]!.value}.`);
  if (src.values["calories"]) highlights.push(`Calories today: ${src.values["calories"]!.value}.`);
  if (src.values["weekly_load"]) highlights.push(`Weekly load: ${src.values["weekly_load"]!.value}.`);

  // ── next recommended adjustment (grounded) ──
  const recovery = src.values["recovery"]?.value;
  let adjustment: string;
  if (recovery) {
    adjustment = `Review today's plan against recovery=${recovery} before training; defer high load if recovery is low.`;
  } else if (detected) {
    adjustment = "Data is partially available — surface nutrition + load metrics to enable a concrete adjustment.";
  } else {
    adjustment = "Configure fitness data sources before HartOS can recommend a training adjustment.";
  }
  fields.push(okField("adjustment", "Next recommended adjustment", adjustment, { source: "derived", confidence: "low" }));

  for (const card of agent?.cards ?? []) {
    for (const miss of card.missingSources) {
      if (!gaps.includes(`missing source: ${miss}`)) gaps.push(`missing source: ${miss}`);
    }
  }
  for (const f of fields) if (f.status !== "ok") gaps.push(`${f.label}: ${f.value}`);

  const status: DomainPanelStatus = !anyConfig ? "unconfigured" : detected ? "detected" : "configured";
  // Phase 13.6 — when the read-model is RPC-backed and not live, lead with the
  // precise RPC setup step (e.g. set HARTOS_USER_ID / grant EXECUTE) instead of
  // the generic table-oriented hints.
  const preciseRpcStep = rm?.rpcStatus && rm.rpcStatus !== "rpc_live" ? rm.recommendation : null;
  const missingSetupSteps = [...new Set([...(preciseRpcStep ? [preciseRpcStep] : []), ...setup])];
  const liveCount = Object.keys(src.values).length;
  const summary = !anyConfig
    ? "Fitness agent not configured. Configure agent-integrations.local.json and/or a fitness read-model to surface real recovery, training, and nutrition status."
    : detected
      ? `Fitness panel resolved ${liveCount} field(s) (${src.sourceType}, freshness=${src.freshness}). ${missingSetupSteps.length} setup step(s) remain for full coverage.`
      : "Fitness agent configured but no live data detected yet. Complete the setup steps to populate recovery, training, and nutrition fields.";

  const nextAction = !anyConfig ? CONFIGURE_AGENT_STEP : preciseRpcStep ?? missingSetupSteps[0] ?? "npm run agents:status";
  const confidence = liveCount > 0 ? src.confidence : "low";

  return {
    id: "fitness",
    title: "Fitness Agent",
    status,
    detected,
    summary,
    fields,
    highlights,
    gaps,
    nextAction,
    missingSetupSteps,
    sources,
    confidence,
    generatedAt: inputs.now,
  };
}
