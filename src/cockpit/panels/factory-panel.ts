/**
 * src/cockpit/panels/factory-panel.ts
 *
 * Phase 12A — Factory / Build New Agent Panel builder. Pure function of
 * PanelInputs.
 *
 * Surfaces what the local Factory can do RIGHT NOW: present modules
 * (Orchestrator, CTO, Beezulbub, …), registered capabilities, the last
 * verification artefact, a grounded "suggested next build", and concrete
 * build-agent entry prompts. Read-only. Never claims a capability exists that
 * the registry does not list.
 */

import type { SourceResult } from "../sources/source-types.js";
import { deriveFactorySource } from "../sources/factory-source.js";
import type { DomainPanel, DomainPanelStatus, PanelField } from "./panel-types.js";
import { okField, unavailableField, fieldFromSource } from "./panel-types.js";
import type { PanelInputs } from "./panel-inputs.js";

/** Concrete build-agent entry prompts Hart can paste into Ask HartOS. */
export const BUILD_AGENT_EXAMPLES = [
  "Create a tax agent",
  "Create an invoice agent",
  "Improve the fitness agent",
  "Improve the ops agent",
  "What should I build next?",
];

const VERIFY_REPORT_RX = /(verify|launch|production|bootstrap|smoke|orchestrator|cockpit-snapshot)/i;

export function buildFactoryPanel(inputs: PanelInputs): DomainPanel {
  const src: SourceResult = inputs.sources?.factory ?? deriveFactorySource();
  const fields: PanelField[] = [];
  const highlights: string[] = [];
  const gaps: string[] = [];
  const setup = new Set<string>();

  const presentModules = inputs.modules.filter((m) => m.present);
  const sources = ["runtime modules", inputs.capability.present ? "capabilities/capability-registry.json" : "", "local reports"].filter(Boolean) as string[];

  // ── factory status ──
  fields.push(okField("status", "Factory status", "available (local)", { source: "runtime modules", confidence: "high" }));
  highlights.push(`Factory available locally with ${presentModules.length} core module(s).`);

  // ── available capabilities / modules ──
  const moduleLabels = presentModules.map((m) => m.label);
  fields.push(okField("modules", "Available modules", moduleLabels.join(", ") || "none", { source: "runtime modules", confidence: "high" }));

  if (inputs.capability.present && inputs.capability.count > 0) {
    const byStatus = Object.entries(inputs.capability.byStatus).map(([k, v]) => `${k}:${v}`).join(", ");
    fields.push(okField("capabilities", "Registered capabilities", `${inputs.capability.count} (${byStatus || "n/a"})${inputs.capability.names.length ? ` — e.g. ${inputs.capability.names.slice(0, 3).join(", ")}` : ""}`, { source: "capability registry", confidence: "high" }));
    highlights.push(`${inputs.capability.count} registered capability(ies).`);
  } else {
    fields.push(unavailableField("capabilities", "Registered capabilities", "no_data", "Acquire a capability with Beezulbub (`npm run beezulbub:scout` → digest → pack), then `npm run beezulbub:capability-list`.", "capability registry"));
    setup.add("Run a Beezulbub scout/digest/pack cycle to register the first capability.");
  }

  // ── Beezulbub availability ──
  const beez = inputs.modules.find((m) => m.id === "beezulbub");
  if (beez?.present) {
    fields.push(okField("beezulbub", "Beezulbub", `available (${inputs.capability.count} capability(ies) tracked)`, { source: "runtime modules", confidence: "high" }));
  } else {
    fields.push(unavailableField("beezulbub", "Beezulbub", "unknown", "Beezulbub module not detected in this runtime.", "runtime modules"));
    gaps.push("Beezulbub module not detected.");
  }

  // ── Orchestrator / CTO availability ──
  const orch = inputs.modules.find((m) => m.id === "orchestrator");
  const cto = inputs.modules.find((m) => m.id === "cto");
  fields.push(okField("orchestrator", "Orchestrator / CTO", `${orch?.present ? "Orchestrator ok" : "Orchestrator missing"}, ${cto?.present ? "CTO ok" : "CTO missing"}`, { source: "runtime modules", confidence: "high" }));

  // ── last factory verification status (with freshness from the source) ──
  const verifySv = src.values["last_verification"];
  if (verifySv) {
    fields.push(fieldFromSource("last_verification", "Last verification artefact", verifySv));
  } else {
    const verifyReport = inputs.reports.find((r) => VERIFY_REPORT_RX.test(r.relativePath));
    if (verifyReport) {
      fields.push(okField("last_verification", "Last verification artefact", verifyReport.relativePath, { source: "local reports", confidence: "medium" }));
    } else {
      fields.push(unavailableField("last_verification", "Last verification artefact", "no_data", "Run `npm run verify` (or a launch/bootstrap check) to produce a verification artefact.", "local reports"));
    }
  }

  // ── latest generated-agent verification ──
  const genSv = src.values["last_generated_verification"];
  if (genSv) {
    fields.push(fieldFromSource("last_generated_verification", "Latest generated-agent verification", genSv));
  } else {
    fields.push(unavailableField("last_generated_verification", "Latest generated-agent verification", "no_data", "Run `npm run verify` / `npm run smoke:local` in the generated agent to produce an artefact.", "local reports"));
  }

  // ── latest validation/test counts ──
  const countsSv = src.values["validation_counts"];
  if (countsSv) {
    fields.push(fieldFromSource("validation_counts", "Latest validation/test counts", countsSv));
    highlights.push(`Latest validation: ${countsSv.value}.`);
  } else {
    fields.push(unavailableField("validation_counts", "Latest validation/test counts", "no_data", "Run `npm test` / `npm run verify` to produce a report with test counts.", "local reports"));
  }

  // ── latest build reports ──
  const buildSv = src.values["last_build_report"];
  if (buildSv) {
    fields.push(fieldFromSource("last_build_report", "Latest build report", buildSv));
  } else {
    fields.push(unavailableField("last_build_report", "Latest build report", "no_data", "Run an Orchestrator/Beezulbub command to produce a build report.", "local reports"));
  }

  // ── latest cockpit report ──
  const cockpitSv = src.values["last_cockpit_report"];
  if (cockpitSv) {
    fields.push(fieldFromSource("last_cockpit_report", "Latest cockpit report", cockpitSv));
  } else {
    fields.push(unavailableField("last_cockpit_report", "Latest cockpit report", "no_data", "Run `npm run cockpit:snapshot` to produce a cockpit report.", "local reports"));
  }

  // ── suggested next build (grounded in real config gaps) ──
  const fitnessConfigured = inputs.agentIntegration.agents.some((a) => a.agentType === "fitness");
  const opsConfigured = inputs.agentIntegration.agents.some((a) => a.agentType === "ops");
  const anyReadModel = inputs.readModels.enabledReadModels > 0;
  let suggested: string;
  if (!inputs.agentIntegration.configPresent) {
    suggested = "Configure agent-integrations.local.json so HartOS can see your real Ops/Fitness agents (copy agent-integrations.example.json).";
  } else if (fitnessConfigured && !anyReadModel) {
    suggested = "Improve the fitness agent: connect a read-only fitness read-model so recovery/training/nutrition become live.";
  } else if (opsConfigured && !anyReadModel) {
    suggested = "Improve the ops agent: connect a read-only ops read-model so urgent/blocked cards become live.";
  } else if (inputs.capability.count === 0) {
    suggested = "Acquire a foundational capability via Beezulbub before building a new specialist agent.";
  } else {
    suggested = "Pick the highest-leverage specialist (e.g. a tax or invoice agent) and run it through Ask HartOS for a build plan.";
  }
  fields.push(okField("suggested_build", "Suggested next build", suggested, { source: "derived from config", confidence: "medium" }));

  // ── build-agent entry prompts ──
  fields.push(okField("entry_prompts", "Build-agent entry prompts", BUILD_AGENT_EXAMPLES.join(" | "), { source: "static examples", confidence: "high" }));

  for (const f of fields) {
    if (f.status !== "ok") gaps.push(`${f.label}: ${f.value}`);
  }

  // Factory is always at least "available" because the modules ship in-runtime.
  const status: DomainPanelStatus = orch?.present ? "available" : "unavailable";
  const detected = presentModules.length > 0;
  const missingSetupSteps = [...setup];

  const summary = `Factory is ${status}. ${presentModules.length} module(s) present, ${inputs.capability.count} capability(ies) registered. Suggested next build: ${suggested}`;

  const confidence = detected ? "high" : "low";

  return {
    id: "factory",
    title: "Factory / Build New Agent",
    status,
    detected,
    summary,
    fields,
    highlights,
    gaps,
    nextAction: suggested,
    missingSetupSteps,
    sources,
    confidence,
    generatedAt: inputs.now,
  };
}
