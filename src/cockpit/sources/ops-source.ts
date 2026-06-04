/**
 * src/cockpit/sources/ops-source.ts
 *
 * Phase 13C — read-only Ops source. Priority: live read-model → local ops
 * reports → handover → unavailable + setup step. Never queries ClickUp directly
 * and never writes. Card counts come only from already-governed read-only
 * boundaries.
 */

import type { AgentIntegrationConfig } from "../../agents/agent-types.js";
import type { ReadModelSummary } from "../../read-models/read-model-types.js";
import type { SourceResult, SourceValue } from "./source-types.js";
import { emptyDiagnostics } from "./source-types.js";
import { layeredResolve, summarizeValues, type SourceLayer } from "./layered.js";
import { findLatestReport, parseKeyValues, pick } from "./local-report-source.js";
import { readHandover } from "./handover-source.js";

export const OPS_FIELD_KEYS = [
  "active_cards", "urgent", "blocked", "stale", "waiting", "no_next_action",
  "risk_flags", "recent_updates", "clickup_sync", "pending_approvals", "latest_updates",
];

const ENABLE_READMODEL_STEP =
  "Enable an ops read-model in read-models.local.json (mode supabase_readonly) and run `npm run read-models:status`.";

function opsLiveLayer(rm: ReadModelSummary | undefined): SourceLayer {
  const m = rm?.metrics ?? {};
  const lines = rm?.lines ?? [];
  const syncLine = lines.find((l) => /sync/i.test(l));
  return {
    sourceType: "supabase_readonly",
    source: rm ? `supabase:${rm.id}` : "read-model",
    lastUpdated: rm?.dataFreshness ?? null,
    values: {
      active_cards: m["activeCards"] != null ? String(m["activeCards"]) : undefined,
      urgent: m["urgentCards"] != null ? String(m["urgentCards"]) : m["urgent"] != null ? String(m["urgent"]) : undefined,
      blocked: m["blockedCards"] != null ? String(m["blockedCards"]) : m["riskCards"] != null ? String(m["riskCards"]) : m["blocked"] != null ? String(m["blocked"]) : undefined,
      stale: m["staleCards"] != null ? String(m["staleCards"]) : undefined,
      waiting: m["waitingCards"] != null ? String(m["waitingCards"]) : undefined,
      no_next_action: m["noNextActionCards"] != null ? String(m["noNextActionCards"]) : undefined,
      risk_flags: m["riskFlags"] != null ? String(m["riskFlags"]) : undefined,
      recent_updates: m["latestUpdate"] != null ? String(m["latestUpdate"]) : undefined,
      pending_approvals: m["pendingApprovals"] != null ? String(m["pendingApprovals"]) : m["approvals"] != null ? String(m["approvals"]) : undefined,
      clickup_sync: syncLine ?? (m["activeCards"] != null ? `${m["activeCards"]} cards imported` : undefined),
      latest_updates: m["latestUpdate"] != null ? String(m["latestUpdate"]) : rm && (rm.status === "ok" || rm.status === "degraded") ? lines[0] : undefined,
    },
  };
}

function kvLayer(sourceType: SourceLayer["sourceType"], source: string, lastUpdated: string | null, kv: Record<string, string>): SourceLayer {
  return {
    sourceType,
    source,
    lastUpdated,
    values: {
      active_cards: pick(kv, "active cards", "cards"),
      urgent: pick(kv, "urgent", "urgent cards", "urgent items"),
      blocked: pick(kv, "blocked", "blocked cards", "risk cards", "at risk", "blocked / risk cards"),
      stale: pick(kv, "stale", "stale cards"),
      waiting: pick(kv, "waiting", "waiting cards", "waiting on hart"),
      no_next_action: pick(kv, "no next action", "no next action cards", "cards without next action"),
      risk_flags: pick(kv, "risk flags", "risks", "operational risks"),
      recent_updates: pick(kv, "recent updates", "recent card updates"),
      pending_approvals: pick(kv, "pending approvals", "approvals"),
      clickup_sync: pick(kv, "clickup sync", "sync", "sync status", "import status", "clickup import / sync status"),
      latest_updates: pick(kv, "latest update", "latest card updates", "update"),
    },
  };
}

function finishOps(values: Record<string, SourceValue>, checked: string[]): SourceResult {
  const summary = summarizeValues(values);
  const resolvedCount = Object.keys(values).length;
  const status: SourceResult["status"] = resolvedCount === 0 ? "unavailable" : resolvedCount >= OPS_FIELD_KEYS.length ? "available" : "partial";
  const diagnostics = emptyDiagnostics();
  diagnostics.checked.push(...checked);
  diagnostics.notes.push(`resolved ${resolvedCount} ops field(s)`);
  return {
    name: "ops",
    sourceType: summary.sourceType,
    status,
    lastUpdated: summary.lastUpdated,
    freshness: summary.freshness,
    confidence: summary.confidence,
    missingReason: status === "unavailable" ? "No live read-model, report, or handover provided ops data." : null,
    setupStep: status === "available" ? null : ENABLE_READMODEL_STEP,
    diagnostics,
    values,
  };
}

export function deriveOpsSource(rm: ReadModelSummary | undefined, now: string): SourceResult {
  const values = layeredResolve(OPS_FIELD_KEYS, [opsLiveLayer(rm)], now);
  return finishOps(values, ["read-model"]);
}

export interface OpsSourceOptions {
  cwd: string;
  now: string;
  rm?: ReadModelSummary;
  agentConfig?: AgentIntegrationConfig;
}

export async function resolveOpsSource(options: OpsSourceOptions): Promise<SourceResult> {
  const { cwd, now, rm, agentConfig } = options;
  const checked: string[] = ["read-model"];
  const layers: SourceLayer[] = [opsLiveLayer(rm)];

  const dirs = [agentConfig?.reportsPath, "ops-reports", "agent-reports"].filter((d): d is string => !!d);
  if (dirs.length) {
    const report = await findLatestReport(cwd, dirs, /ops|card|sync|dd|analyse|digest|proposal/i);
    checked.push("local-report");
    if (report) layers.push(kvLayer("local_report", report.relativePath, report.lastUpdated, parseKeyValues(report.content)));
  }

  const handover = await readHandover(cwd, agentConfig?.handoverPath);
  checked.push("handover");
  if (handover) layers.push(kvLayer("handover", handover.relativePath, handover.lastUpdated, handover.keyValues));

  const values = layeredResolve(OPS_FIELD_KEYS, layers, now);
  return finishOps(values, checked);
}
