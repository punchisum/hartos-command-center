/**
 * src/cockpit/panels/ops-panel.ts
 *
 * Phase 12A panel, upgraded for Phase 13C. Card/sync/approval fields come from a
 * resolved read-only Ops SourceResult (live read-model → local report →
 * handover, with freshness); DD/analyse + recent-report fields come from the
 * local report listing. Pure: derives the source from in-memory summaries when
 * none is supplied. Never queries ClickUp, never writes.
 */

import type { AgentReadModel } from "../../agents/agent-types.js";
import type { ReadModelSummary } from "../../read-models/read-model-types.js";
import type { SourceResult } from "../sources/source-types.js";
import { deriveOpsSource } from "../sources/ops-source.js";
import type { DomainPanel, DomainPanelStatus, PanelField, PanelFieldStatus, PanelConfidence } from "./panel-types.js";
import { okField, unavailableField, fieldFromSource } from "./panel-types.js";
import type { PanelInputs } from "./panel-inputs.js";
import { triageOps, opsSignalsFromSource } from "../../ops/triage-core.js";

const ENABLE_READMODEL_STEP =
  "Enable an ops read-model in read-models.local.json (mode supabase_readonly) and run `npm run read-models:status`.";
const CARD_STATUS_STEP =
  "Allowlist `clickup_cards` with a status/priority field in the ops read-model so urgent/blocked counts can be derived.";
const APPROVALS_STEP =
  "Expose a pending-approvals view (e.g. a proposals table) in the ops read-model allowedTables.";
const CONFIGURE_AGENT_STEP =
  "Configure the ops agent in agent-integrations.local.json (repoPath/reportsPath/handoverPath) and run `npm run agents:status`.";

interface FieldSpec { key: string; label: string; setupStep: string; }

const RISK_STEP =
  "Allowlist the read-only ops risk RPC (get_ops_risk_flags) in the ops read-model allowedRpcs so grounded risk flags can be surfaced.";

const OPS_SPECS: FieldSpec[] = [
  { key: "active_cards", label: "Active cards", setupStep: CARD_STATUS_STEP },
  { key: "urgent", label: "Urgent cards / items", setupStep: CARD_STATUS_STEP },
  { key: "blocked", label: "Blocked / risk cards", setupStep: CARD_STATUS_STEP },
  { key: "stale", label: "Stale cards", setupStep: CARD_STATUS_STEP },
  { key: "waiting", label: "Cards waiting on Hart", setupStep: CARD_STATUS_STEP },
  { key: "no_next_action", label: "Cards without a next action", setupStep: CARD_STATUS_STEP },
  { key: "risk_flags", label: "Operational risk flags", setupStep: RISK_STEP },
  { key: "recent_updates", label: "Recent card updates", setupStep: ENABLE_READMODEL_STEP },
  { key: "latest_updates", label: "Latest card updates", setupStep: ENABLE_READMODEL_STEP },
  { key: "clickup_sync", label: "ClickUp import / sync status", setupStep: ENABLE_READMODEL_STEP },
  { key: "pending_approvals", label: "Pending approvals", setupStep: APPROVALS_STEP },
];

function classifyReports(paths: string[]): { dd: string[]; recent: string[] } {
  const dd = paths.filter((p) => /\b(dd|due-?diligence|analyse|analysis|proposal)\b/i.test(p));
  return { dd, recent: paths };
}

export function buildOpsPanel(inputs: PanelInputs): DomainPanel {
  const agent: AgentReadModel | undefined = inputs.agentIntegration.agents.find((a) => a.agentType === "ops");
  const rm: ReadModelSummary | undefined = inputs.readModels.summaries.find((s) => s.type === "ops");
  const src: SourceResult = inputs.sources?.ops ?? deriveOpsSource(rm, inputs.now);

  const agentConfigured = !!agent;
  const rmPresent = !!rm;
  const anyConfig = agentConfigured || rmPresent;
  const rmLive = !!rm && (rm.status === "ok" || rm.status === "degraded");
  const agentDetected = !!agent && (agent.status === "ok" || agent.status === "degraded");

  const sources: string[] = [];
  if (agent) sources.push("agent-integrations.local.json");
  if (rm) sources.push("read-models.local.json (ops)");

  const fields: PanelField[] = [];
  const highlights: string[] = [];
  const gaps: string[] = [];
  const setup = new Set<string>();

  const detected = agentDetected || rmLive || src.status !== "unavailable";

  // ── status ──
  const configuredValue = !anyConfig ? "not configured" : detected ? "detected" : "configured (no live data yet)";
  fields.push(okField("status", "Configured / detected", configuredValue, { source: sources.join(", ") || "none", confidence: detected ? "high" : "low" }));

  // ── data fields from the resolved source ──
  for (const spec of OPS_SPECS) {
    const sv = src.values[spec.key];
    if (sv) {
      fields.push(fieldFromSource(spec.key, spec.label, sv));
    } else {
      const status: Exclude<PanelFieldStatus, "ok"> = anyConfig ? "no_data" : "not_configured";
      fields.push(unavailableField(spec.key, spec.label, status, spec.setupStep, "ops read-model / reports"));
      setup.add(spec.setupStep);
    }
  }

  // ── report-derived fields (DD/analyse + recent reports) ──
  // De-dupe: cards now each carry their own evidence links (see ops-agent-adapter),
  // so the same report can appear under multiple cards — collapse before classifying.
  const agentReports = agent?.cards.flatMap((c) => c.latestReportPaths) ?? [];
  const localReports = inputs.reports.filter((r) => r.dir.includes("report")).map((r) => r.relativePath);
  const { dd, recent } = classifyReports([...new Set([...agentReports, ...localReports])]);
  if (dd.length > 0) {
    fields.push(okField("dd_reports", "Latest DD / analyse reports", dd.slice(0, 3).join(", "), { source: "local reports", confidence: "medium" }));
    highlights.push(`${dd.length} DD/analyse report(s) available.`);
  } else {
    fields.push(unavailableField("dd_reports", "Latest DD / analyse reports", "no_data", "Generate a DD/analyse report (or point the ops agent reportsPath at one) to surface it here.", "local reports / ops agent"));
  }
  if (recent.length > 0) {
    fields.push(okField("recent_reports", "Recent reports / proposals", recent.slice(0, 3).join(", "), { source: "local reports / ops agent", confidence: "medium" }));
  } else {
    fields.push(unavailableField("recent_reports", "Recent reports / proposals", anyConfig ? "no_data" : "not_configured", anyConfig ? "Run an ops report or sync to populate recent reports." : CONFIGURE_AGENT_STEP, "local reports / ops agent"));
    if (!anyConfig) setup.add(CONFIGURE_AGENT_STEP);
  }

  // Highlights from real card data.
  const urgent = src.values["urgent"]?.value;
  const blocked = src.values["blocked"]?.value;
  const stale = src.values["stale"]?.value;
  const waiting = src.values["waiting"]?.value;
  const noNextAction = src.values["no_next_action"]?.value;
  const riskFlags = src.values["risk_flags"]?.value;
  if (urgent && Number(urgent) > 0) highlights.push(`${urgent} urgent card(s).`);
  if (blocked && Number(blocked) > 0) highlights.push(`${blocked} blocked/at-risk card(s).`);
  if (stale && Number(stale) > 0) highlights.push(`${stale} stale card(s).`);
  if (waiting && Number(waiting) > 0) highlights.push(`${waiting} card(s) waiting on Hart.`);
  if (noNextAction && Number(noNextAction) > 0) highlights.push(`${noNextAction} card(s) with no next action.`);
  if (riskFlags) highlights.push(`Risk flags: ${riskFlags}.`);
  if (src.values["active_cards"]) highlights.push(`${src.values["active_cards"]!.value} active card(s).`);
  if (src.values["pending_approvals"] && Number(src.values["pending_approvals"]!.value) > 0) highlights.push(`${src.values["pending_approvals"]!.value} pending approval(s).`);

  // ── next operational action — deterministic TRIAGE core (impact-ranked) ──
  // Ranks ALL fronts (not first-match), honest confidence (no longer hardcoded "low"),
  // and a caveat when the import is stale so the counts aren't trusted blindly.
  const triage = triageOps(opsSignalsFromSource(src));
  const triagePriority: PanelConfidence = triage.verdict === "urgent" ? "high" : triage.verdict === "act" ? "medium" : "low";
  const triageAct = triage.verdict === "urgent" || triage.verdict === "act";
  const advisory = detected ? { verdict: triage.verdict, priority: triagePriority, act: triageAct, headline: triage.primaryAction } : null;
  const opAction = detected ? triage.primaryAction : "Configure ops data sources before HartOS can recommend an operational action.";
  fields.push(okField("next_action", "Next operational action", opAction, { source: "derived (triage)", confidence: detected ? triage.confidence : "low" }));
  if (detected && triage.queue.length) {
    const q = triage.queue.map((i) => (i.count > 0 ? `${i.category} ${i.count}` : i.category)).join(" → ");
    fields.push(okField("triage_queue", "Triage queue (priority order)", q, { source: "derived (triage)", confidence: triage.confidence }));
  }
  if (detected && triage.caveats.length) {
    fields.push(okField("triage_caveat", "Triage caveat", triage.caveats.join(" "), { source: "derived (triage)", confidence: triage.confidence }));
  }
  // Depth: operator framing (Operator contract) — what it means, what's at risk, the cheap win.
  if (detected) {
    fields.push(okField("triage_impact", "Operational impact", triage.impact, { source: "derived (triage)", confidence: triage.confidence }));
    if (triage.risks.length) {
      fields.push(okField("triage_risks", "Operational risks", triage.risks.join(" "), { source: "derived (triage)", confidence: triage.confidence }));
    }
    if (triage.opportunity) {
      fields.push(okField("triage_opportunity", "Quick win", triage.opportunity, { source: "derived (triage)", confidence: triage.confidence }));
    }
  }

  for (const card of agent?.cards ?? []) {
    for (const miss of card.missingSources) {
      if (!gaps.includes(`missing source: ${miss}`)) gaps.push(`missing source: ${miss}`);
    }
  }
  for (const f of fields) if (f.status !== "ok") gaps.push(`${f.label}: ${f.value}`);

  const status: DomainPanelStatus = !anyConfig ? "unconfigured" : detected ? "detected" : "configured";
  const missingSetupSteps = [...setup];
  const liveCount = Object.keys(src.values).length;
  const summary = !anyConfig
    ? "Ops agent not configured. Configure agent-integrations.local.json and/or an ops read-model to surface urgent/blocked cards, sync status, and reports."
    : detected
      ? `Ops panel resolved ${liveCount} field(s) (${src.sourceType}, freshness=${src.freshness}). ${missingSetupSteps.length} setup step(s) remain for full card/approval coverage.`
      : "Ops agent configured but no live data detected yet. Complete the setup steps to populate cards, sync, and approvals.";

  const nextAction = !anyConfig ? CONFIGURE_AGENT_STEP : missingSetupSteps[0] ?? "npm run agents:status";
  const confidence = liveCount > 0 ? src.confidence : "low";

  return {
    id: "ops",
    title: "Ops Agent",
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
    ...(advisory ? { advisory } : {}),
    generatedAt: inputs.now,
  };
}
