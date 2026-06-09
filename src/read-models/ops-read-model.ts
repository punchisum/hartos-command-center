/**
 * src/read-models/ops-read-model.ts
 *
 * Summarizes Ops data through the read-only Supabase boundary.
 *
 * Ops Read-Model Surface Upgrade — RPC-backed reads. When `allowedRpcs` is
 * configured the adapter PREFERS the ops-agent-v2 read-only RPCs
 * (get_ops_overview / _attention_cards / _recent_updates / _status_counts /
 * _risk_flags) over raw table selects, because those RPCs return curated,
 * operator-level surfaces (urgent / blocked / stale / waiting / no-next-action
 * cards, recent updates, status counts, grounded risk flags). It calls
 * `client.readRpc()` ONLY for names the config allowlists — anything else fails
 * closed inside the client. When no RPCs are allowlisted it falls back to the
 * original allowlisted table-select path (preserved verbatim). No mutation is
 * possible; service-role keys are rejected upstream. Errors never expose secret
 * values (only the RPC name + HTTP status are surfaced).
 */

import type {
  FitnessRpcStatus,
  ReadModelAvailability,
  ReadModelConfig,
  ReadModelSummary,
} from "./read-model-types.js";
import { SupabaseReadError, type SupabaseReadClient } from "./supabase-read-client.js";

/** Known read-only Ops RPCs (must be allowlisted in config to be called). */
export const OPS_RPCS = {
  overview: "get_ops_overview",
  attentionCards: "get_ops_attention_cards",
  recentUpdates: "get_ops_recent_updates",
  statusCounts: "get_ops_status_counts",
  riskFlags: "get_ops_risk_flags",
} as const;

type Rec = Record<string, unknown>;

function countBy(rows: Array<Record<string, unknown>>, field: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r[field] ?? "unknown");
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A PostgREST RPC returning a scalar jsonb object: the body IS the object. */
function asObject(body: unknown): Rec | undefined {
  if (isRec(body)) return body;
  if (Array.isArray(body)) return body.find(isRec);
  return undefined;
}

/** A PostgREST RPC returning a jsonb array: the body IS the array. */
function asArray(body: unknown): Rec[] {
  if (Array.isArray(body)) return body.filter(isRec);
  if (isRec(body)) return [body];
  return [];
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

interface RpcOutcome {
  reached: boolean;
  status?: number;
  body: unknown;
}

/** Call one allowlisted RPC, classifying the outcome. Never throws. */
async function callRpc(client: SupabaseReadClient, name: string, args: Rec): Promise<RpcOutcome> {
  try {
    const body = await client.readRpc(name, args);
    return { reached: true, body };
  } catch (err) {
    const status = err instanceof SupabaseReadError ? err.status : undefined;
    return { reached: false, status, body: undefined };
  }
}

function worstRpcStatus(statuses: Array<number | undefined>): FitnessRpcStatus {
  if (statuses.some((s) => s === 403)) return "rpc_forbidden";
  if (statuses.some((s) => s === 404)) return "rpc_unavailable";
  if (statuses.some((s) => s === 400 || s === 422)) return "rpc_shape_mismatch";
  return "rpc_unavailable";
}

function setupStepFor(rpcStatus: FitnessRpcStatus): string {
  switch (rpcStatus) {
    case "rpc_forbidden":
      return "Grant EXECUTE on the read-only ops RPCs to the anon role (read-only), e.g. via the SECURITY DEFINER functions in migration 20260604120000_phase_ops_read_surfaces.sql.";
    case "rpc_unavailable":
      return "Deploy/expose the read-only ops RPCs (get_ops_overview / _attention_cards / _recent_updates / _status_counts / _risk_flags) in the ops-agent-v2 Supabase project.";
    case "rpc_shape_mismatch":
      return "An ops RPC returned an unexpected shape — verify the function definitions match the ops read-surfaces contract.";
    case "rpc_no_rows":
      return "Ops RPCs are reachable but returned no rows — confirm clickup_cards has active (non-archived) cards.";
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
    attentionCards?: Array<{ cardId: string; cardName: string; status: string }>;
  }
): ReadModelSummary {
  return { id: config.id, type: "ops", ...fields };
}

/** RPC-backed path — preferred when allowedRpcs is configured. */
async function buildFromRpcs(config: ReadModelConfig, client: SupabaseReadClient): Promise<ReadModelSummary> {
  const metrics: Record<string, string | number> = {};
  const lines: string[] = [];
  const degradedSources: string[] = [];
  const failures: Array<number | undefined> = [];
  let reachedAny = false;
  let dataFreshness: string | null = null;
  let attentionCardRefs: Array<{ cardId: string; cardName: string; status: string }> = [];

  const wanted: Array<{ name: string; args: Rec }> = [
    { name: OPS_RPCS.overview, args: { p_stale_days: 14 } },
    { name: OPS_RPCS.attentionCards, args: { p_stale_days: 14, p_limit: 50 } },
    { name: OPS_RPCS.recentUpdates, args: { p_limit: 10 } },
    { name: OPS_RPCS.statusCounts, args: {} },
    { name: OPS_RPCS.riskFlags, args: { p_stale_days: 14 } },
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

    if (name === OPS_RPCS.overview) {
      const o = asObject(outcome.body);
      if (o) {
        const active = num(o["active_card_count"]);
        const blocked = num(o["blocked_card_count"]);
        const waiting = num(o["waiting_card_count"]);
        const urgent = num(o["urgent_card_count"]);
        const stale = num(o["stale_card_count"]);
        const noAction = num(o["no_next_action_count"]);
        if (active != null) metrics["activeCards"] = active;
        if (blocked != null) metrics["blockedCards"] = blocked;
        if (waiting != null) metrics["waitingCards"] = waiting;
        if (urgent != null) metrics["urgentCards"] = urgent;
        if (stale != null) metrics["staleCards"] = stale;
        if (noAction != null) metrics["noNextActionCards"] = noAction;
        dataFreshness = str(o["data_freshness"]) ?? str(o["latest_update_at"]) ?? dataFreshness;
        const flags = Array.isArray(o["data_quality_flags"]) ? (o["data_quality_flags"] as unknown[]).map(String) : [];
        if (flags.length) metrics["dataQualityFlags"] = flags.join(", ");
        lines.push(
          `Active cards: ${active ?? 0} (urgent:${urgent ?? 0}, blocked:${blocked ?? 0}, waiting:${waiting ?? 0}, stale:${stale ?? 0}, no-action:${noAction ?? 0}).`
        );
      }
    } else if (name === OPS_RPCS.attentionCards) {
      const cards = asArray(outcome.body);
      metrics["attentionCards"] = cards.length;
      const top = cards.slice(0, 3).map((c) => {
        const title = str(c["title"]) ?? "card";
        const reason = str(c["reason_flag"]) ?? "attention";
        return `${title} [${reason}]`;
      });
      if (top.length) {
        metrics["attentionTop"] = top.join("; ");
        lines.push(`Attention cards: ${cards.length} (${top.join("; ")}).`);
      }
      // Cockpit V2 — preserve the card id/name/status tuples (not just the count) so a mutation
      // instruction can resolve "this operation" to a real card. Only rows with a stable id+title.
      attentionCardRefs = cards
        .map((c) => ({ cardId: str(c["card_id"]) ?? "", cardName: str(c["title"]) ?? str(c["card_title"]) ?? "", status: str(c["status"]) ?? "" }))
        .filter((c) => c.cardId && c.cardName);
    } else if (name === OPS_RPCS.recentUpdates) {
      const updates = asArray(outcome.body);
      metrics["recentUpdateCount"] = updates.length;
      const first = updates[0];
      if (first) {
        const card = str(first["card_title"]) ?? "card";
        const text = str(first["update_summary"]) ?? str(first["update_text"]) ?? "";
        const by = str(first["updated_by"]);
        const at = str(first["updated_at"]);
        metrics["latestUpdate"] = `${card}: ${text}`.slice(0, 200);
        // The overview's latest_update_at is authoritative (max activity);
        // only fall back to a recent-update timestamp when none was set.
        dataFreshness = dataFreshness ?? at ?? null;
        lines.push(`Latest update: ${card} — ${text}${by ? ` (${by})` : ""}.`);
      }
    } else if (name === OPS_RPCS.statusCounts) {
      const o = asObject(outcome.body);
      if (o) {
        const total = num(o["total"]);
        if (total != null) metrics["statusCountTotal"] = total;
        const byStatus = isRec(o["by_status"]) ? (o["by_status"] as Rec) : {};
        const parts = Object.entries(byStatus).map(([k, v]) => `${k}:${String(v)}`);
        if (parts.length) {
          metrics["statusCounts"] = parts.join(", ");
          lines.push(`Status counts: ${parts.join(", ")}.`);
        }
      }
    } else if (name === OPS_RPCS.riskFlags) {
      const flags = asArray(outcome.body);
      metrics["riskFlagCount"] = flags.length;
      const rendered = flags.map((f) => {
        const flag = str(f["flag"]) ?? "risk";
        const count = num(f["card_count"]) ?? 0;
        const sev = str(f["severity"]) ?? "low";
        return `${flag}:${count} (${sev})`;
      });
      if (rendered.length) {
        metrics["riskFlags"] = rendered.join(", ");
        lines.push(`Risk flags (derived): ${rendered.join(", ")}.`);
      }
    }
  }

  const hasData = Object.keys(metrics).length > 0;

  if (!hasData) {
    if (!reachedAny && failures.length > 0) {
      const rpcStatus = worstRpcStatus(failures);
      return summary(config, {
        status: "error",
        confidence: "low",
        lines: [`Ops RPCs unavailable (status ${failures.map((s) => s ?? "n/a").join(", ")}).`],
        metrics: {},
        recommendation: setupStepFor(rpcStatus),
        dataFreshness: null,
        degradedSources,
        rpcStatus,
      });
    }
    const rpcStatus: FitnessRpcStatus = reachedAny ? "rpc_no_rows" : "rpc_unavailable";
    return summary(config, {
      status: "missing",
      confidence: "low",
      lines: [reachedAny ? "Ops RPCs reachable but returned no rows." : "No known ops RPCs are allowlisted."],
      metrics: {},
      recommendation: setupStepFor(rpcStatus),
      dataFreshness: null,
      degradedSources,
      rpcStatus,
    });
  }

  const degraded = degradedSources.length > 0;
  return summary(config, {
    status: degraded ? "degraded" : "ok",
    confidence: degraded ? "medium" : "high",
    lines: lines.length ? lines : ["Ops read-only RPC data resolved."],
    metrics,
    recommendation: "Read-only; review in the cockpit.",
    dataFreshness,
    degradedSources,
    rpcStatus: "rpc_live",
    ...(attentionCardRefs.length ? { attentionCards: attentionCardRefs } : {}),
  });
}

/** Table-backed path — preserved fallback when no RPCs are allowlisted. */
async function buildFromTables(config: ReadModelConfig, client: SupabaseReadClient): Promise<ReadModelSummary> {
  const degradedSources: string[] = [];
  const metrics: Record<string, string | number> = {};
  const lines: string[] = [];
  let dataFreshness: string | null = null;

  try {
    if (config.allowedTables.includes("clickup_cards")) {
      const cards = await client.select("clickup_cards", { limit: 500 });
      metrics["activeCards"] = cards.length;
      const byStatus = countBy(cards, "status");
      lines.push(`Active cards: ${cards.length} (${Object.entries(byStatus).map(([k, v]) => `${k}:${v}`).join(", ") || "none"}).`);
    } else {
      degradedSources.push("clickup_cards");
    }
    if (config.allowedTables.includes("sync_runs")) {
      const runs = await client.select("sync_runs", { limit: 1, order: "created_at" });
      const latest = runs[0];
      if (latest) {
        dataFreshness = String(latest["created_at"] ?? latest["finished_at"] ?? "") || null;
        lines.push(`Latest sync: ${String(latest["status"] ?? "unknown")} at ${dataFreshness ?? "unknown"}.`);
      }
    }
    if (config.allowedTables.includes("agent_logs")) {
      const logs = await client.select("agent_logs", { limit: 1, order: "created_at" });
      if (logs[0]) lines.push(`Latest agent log severity: ${String(logs[0]["severity"] ?? "info")}.`);
    }
  } catch (err) {
    return summary(config, {
      status: "error",
      confidence: "low",
      lines: [`Ops read failed: ${(err as Error).message}`],
      metrics,
      recommendation: "Check the read-only Supabase boundary configuration.",
      dataFreshness,
      degradedSources,
    });
  }

  return summary(config, {
    status: degradedSources.length > 0 ? "degraded" : "ok",
    confidence: degradedSources.length > 0 ? "medium" : "high",
    lines: lines.length > 0 ? lines : ["No rows returned from allowlisted ops tables."],
    metrics,
    recommendation: "Read-only; review in the cockpit.",
    dataFreshness,
    degradedSources,
  });
}

export async function buildOpsReadModelSummary(
  config: ReadModelConfig,
  availability: ReadModelAvailability,
  client?: SupabaseReadClient
): Promise<ReadModelSummary> {
  if (!config.enabled) {
    return summary(config, {
      status: "disabled",
      confidence: "low",
      lines: ["Ops read model is disabled. Set enabled=true in read-models.local.json to connect real data."],
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
      lines: [`Ops read model enabled but env/client missing: ${availability.missingEnv.join(", ") || "no client"}.`],
      metrics: {},
      recommendation: "Set the Supabase URL + read-only key env vars.",
      dataFreshness: null,
      degradedSources: availability.missingEnv,
      ...(rpcMode ? { rpcStatus: "rpc_missing_env" as FitnessRpcStatus } : {}),
    });
  }

  // Prefer the read-only RPC surface when allowlisted; otherwise table fallback.
  if (config.allowedRpcs.length > 0) {
    return buildFromRpcs(config, client);
  }
  return buildFromTables(config, client);
}
