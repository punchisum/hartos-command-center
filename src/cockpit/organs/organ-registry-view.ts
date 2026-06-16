/**
 * src/cockpit/organs/organ-registry-view.ts — SP-Organs F6: the PURE cockpit organ-registry view.
 *
 * Joins each agent_registry contract row with its latest organ_runs evidence, assembles OrganEvidence,
 * and DERIVES the displayed status via deriveOrganStatus. Doctrine: UI = Reflect(SOT); status is NEVER
 * hardcoded — it falls straight out of evidence (fresh heartbeat + real run + output_ref + readback ⇒
 * LIVE; anything short ⇒ REGISTERED/PARTIAL; failed/stale ⇒ FAILED; retired ⇒ RETIRED).
 *
 * PURE / Worker-safe: no node:/net/clock imports. `now` is injected. Never throws — malformed/missing
 * rows degrade safely (a row with no agentId is skipped; a missing/garbage timestamp ⇒ heartbeatAgeSec
 * null, which the deriver treats as "no heartbeat"). It DESCRIBES + PROJECTS; it never executes/fetches.
 *
 * Inputs are the two RPC payloads, untyped on the wire:
 *   - registryRows: rows from hartos_list_agent_registry() (the runtime contract + evidence columns).
 *   - organRuns:    rows from hartos_list_organ_runs(p_limit) (latest N runs per organ, newest-first).
 */

import { deriveOrganStatus } from "../../organs/derive-organ-status.js";
import type { OrganEvidence, OrganStatus, OrganTrigger } from "../../organs/organ-contract.js";
import type { MetaAgentRegistry, MetaAgent, AgentStatus } from "../../agents/meta-agent-registry.js";

/** A render-ready organ row, derived purely from the registry contract + run evidence. */
export interface OrganView {
  agentId: string;
  displayName: string;
  runtimeKind: string;
  tier: string;
  detailPage: string | null;
  /** Computed-at-read-time status (deriveOrganStatus) — NEVER taken from a hardcoded source. */
  status: OrganStatus;
  lastRunAt: string | null;
  lastOutputRef: string | null;
  heartbeatSource: string | null;
  /** The env flag that arms the organ's hands, or null if none. */
  armingFlag: string | null;
  canExecute: boolean;
  canWriteExternal: boolean;
  knownRisks: string[];
  /** The latest run's summary (the cockpit's one-line "what it last did"), or null. */
  lastRunSummary: string | null;
}

const REAL_TRIGGERS: readonly string[] = ["scheduled", "on_demand", "worker"];
const DEFAULT_STALENESS_SEC = 900;

type Row = Record<string, unknown>;

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function asNullableString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function asBool(v: unknown): boolean {
  return v === true;
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function asInt(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return fallback;
}

/** permissions.execute lives in a jsonb column; tolerate object | JSON-string | absent. */
function permissionsExecute(v: unknown): boolean {
  let obj: unknown = v;
  if (typeof v === "string") {
    try {
      obj = JSON.parse(v);
    } catch {
      return false;
    }
  }
  return !!obj && typeof obj === "object" && (obj as { execute?: unknown }).execute === true;
}

/** Coerce a trigger string to the OrganTrigger union, defaulting to "worker" for unknowns. */
function asTrigger(v: unknown): OrganTrigger {
  return REAL_TRIGGERS.includes(asString(v)) ? (asString(v) as OrganTrigger) : "worker";
}

/**
 * Heartbeat age in seconds = (now - lastRunAt) clamped at 0; null when either timestamp is
 * absent/unparseable (the deriver then reads "no heartbeat"). Pure — `now` is injected.
 */
function heartbeatAgeSec(lastRunAt: string | null, now: string): number | null {
  if (!lastRunAt) return null;
  const last = Date.parse(lastRunAt);
  const ref = Date.parse(now);
  if (Number.isNaN(last) || Number.isNaN(ref)) return null;
  return Math.max(0, Math.round((ref - last) / 1000));
}

/**
 * Index the latest organ_runs row per organ_id. The RPC returns newest-first per organ
 * (row_number ordering); we keep the FIRST row seen for each organ_id as its latest run.
 * Tolerates a missing/garbage list by returning an empty map.
 */
function indexLatestRuns(organRuns: unknown): Map<string, Row> {
  const map = new Map<string, Row>();
  if (!Array.isArray(organRuns)) return map;
  for (const r of organRuns) {
    if (!r || typeof r !== "object") continue;
    const row = r as Row;
    const id = asString(row["organ_id"]);
    if (!id || map.has(id)) continue; // first (newest) wins
    map.set(id, row);
  }
  return map;
}

/**
 * PURE. Join each registry contract row with its latest organ_runs row, build OrganEvidence, derive
 * the displayed status, and project a render-ready OrganView[].
 *
 * For each registry row:
 *   - heartbeatAgeSec is derived from last_run_at vs `now` (null ⇒ no heartbeat).
 *   - lastRun comes from the latest organ_runs row for this organ (null ⇒ no run yet).
 *   - readbackOk = !!last_output_ref (the cockpit can read the last output back from SOT).
 *   - lifecycleRetired = lifecycle === "retired".
 *   - status = deriveOrganStatus(evidence) — the four-part LIVE gate, verbatim. Never hardcoded.
 *
 * Tolerates missing/partial/malformed input without throwing: a non-array `registryRows` ⇒ [];
 * a row with no agent_id is skipped; everything else degrades to safe defaults.
 */
export function buildOrganRegistryView(
  registryRows: unknown,
  organRuns: unknown,
  now: string,
): OrganView[] {
  const rows = Array.isArray(registryRows) ? registryRows : [];
  const runsByOrgan = indexLatestRuns(organRuns);
  const out: OrganView[] = [];

  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Row;
    const agentId = asString(row["agent_id"]);
    if (!agentId) continue;

    const lastRunAt = asNullableString(row["last_run_at"]);
    const lastOutputRef = asNullableString(row["last_output_ref"]);
    const stalenessThresholdSec = asInt(row["staleness_threshold_sec"], DEFAULT_STALENESS_SEC);
    const lifecycle = asString(row["lifecycle"]);

    const runRow = runsByOrgan.get(agentId) ?? null;
    const lastRun: OrganEvidence["lastRun"] = runRow
      ? {
          ok: asBool(runRow["ok"]),
          trigger: asTrigger(runRow["trigger"]),
          disarmed: asBool(runRow["disarmed"]),
          // errored=true only for a genuine escaped throw ⇒ FAILED. An honest ok:false ⇒ PARTIAL.
          errored: asBool(runRow["errored"]),
          outputRef: asNullableString(runRow["output_ref"]),
        }
      : null;

    const evidence: OrganEvidence = {
      heartbeatAgeSec: heartbeatAgeSec(lastRunAt, now),
      stalenessThresholdSec,
      lastRun,
      // readbackOk reflects the cockpit's ability to read the last output back from SOT. The registry
      // row's last_output_ref IS that SOT handle — its presence is the readback evidence.
      readbackOk: !!lastOutputRef,
      lifecycleRetired: lifecycle === "retired",
    };

    out.push({
      agentId,
      displayName: asString(row["display_name"], agentId),
      runtimeKind: asString(row["runtime_kind"], "daemon-supervised"),
      tier: asString(row["tier"]),
      detailPage: asNullableString(row["detail_page"]),
      status: deriveOrganStatus(evidence),
      lastRunAt,
      lastOutputRef,
      heartbeatSource: asNullableString(row["heartbeat_source"]),
      armingFlag: asNullableString(row["arming_flag"]),
      canExecute: permissionsExecute(row["permissions"]),
      canWriteExternal: asBool(row["can_write_external"]),
      knownRisks: asStringArray(row["known_risks"]),
      lastRunSummary: runRow ? asNullableString(runRow["summary"]) : null,
    });
  }

  return out;
}

// ─── Overlay: derived organ status → the presentational meta-agent registry ───────────────────────
//
// The org panel / fleet topology / constellation / v5 connectome all render from a MetaAgentRegistry,
// reading `agent.status`. Historically that came from the HARDCODED catalog ("live" strings). Doctrine
// forbids that: status must be DERIVED. This overlay keeps the catalog's PRESENTATIONAL metadata
// (hierarchy, role, description, icons/layout keyed by id) but REPLACES each node's status with the
// status the organ-registry view DERIVED from evidence. A catalog node with no matching organ row keeps
// its structure but is honestly downgraded to "unavailable" (no SOT evidence ⇒ never shown "live").

/** Map the derived OrganStatus to the registry's AgentStatus band (used by every page renderer). */
function organToAgentStatus(s: OrganStatus): AgentStatus {
  switch (s) {
    case "LIVE":
      return "live";
    case "STANDBY":
      // Armed + ready, no work yet — amber/partial band (never "live"), but honestly "standby".
      return "partial";
    case "PARTIAL":
      return "partial";
    case "REGISTERED":
      // Registered but no live evidence yet — honestly amber/partial, never "live".
      return "partial";
    case "DISARMED":
      return "unavailable";
    case "FAILED":
      return "unavailable";
    case "RETIRED":
      return "unavailable";
    default:
      return "unavailable";
  }
}

/** A one-line honest reason for the overlaid status (so the panel's non-live reason is truthful). */
function statusReasonFor(v: OrganView): string {
  switch (v.status) {
    case "LIVE":
      return `LIVE — fresh run${v.lastRunSummary ? ` · ${v.lastRunSummary}` : ""}`;
    case "STANDBY":
      return `STANDBY — armed + ready, no work yet${v.lastRunSummary ? ` · ${v.lastRunSummary}` : ""}. Goes LIVE on a trigger.`;
    case "DISARMED":
      return `DISARMED — gate off${v.armingFlag ? ` (${v.armingFlag})` : ""}. Arm it to run.`;
    case "PARTIAL":
      return "PARTIAL — ran with an output but short of the full LIVE gate (no readback / stale-ish).";
    case "REGISTERED":
      return "REGISTERED — present in the registry; no qualifying run evidence yet.";
    case "FAILED":
      return "FAILED — last run errored or the heartbeat is stale.";
    case "RETIRED":
      return "RETIRED.";
    default:
      return "Status derived from evidence.";
  }
}

/**
 * PURE. Return a NEW MetaAgentRegistry whose every node's `status`/`statusReason` is the DERIVED organ
 * status (from `organView`), not the hardcoded catalog string. Hart (the human root) is left untouched
 * (it has no organ row and isn't an organ). Counts are recomputed from the overlaid statuses so the
 * panel's "N live / N partial" header reflects derived truth. The input registry is not mutated.
 *
 * Honest-degradation fallback: if `organView` is empty/missing (no live registry env, read failed), the
 * catalog's hardcoded "live"/"partial" is NOT trusted — doctrine forbids a hardcoded source feeding
 * liveness. Every non-root node is downgraded to "unavailable" with an "evidence unavailable" reason, so
 * the cockpit honestly shows it could not confirm liveness rather than asserting the catalog's "live".
 */
export function applyOrganStatusToRegistry(
  reg: MetaAgentRegistry,
  organView: OrganView[] | null | undefined,
): MetaAgentRegistry {
  const byId = new Map<string, OrganView>();
  for (const v of organView ?? []) byId.set(v.agentId, v);
  const haveEvidence = byId.size > 0;

  const agents: MetaAgent[] = reg.agents.map((a) => {
    if (a.id === reg.rootId) return a; // the human gate is not an organ; leave it as authored.
    // External/detachable assets (e.g. Hunt.sg) run on their own infra — HartOS has no evidence and
    // must not assert their liveness. Leave as authored (local_only), not "not in agent_registry".
    if (a.external) return a;
    const v = byId.get(a.id);
    if (v) return { ...a, status: organToAgentStatus(v.status), statusReason: statusReasonFor(v) };
    // No organ row for this node. Never let its hardcoded catalog status feed liveness:
    //  - no live registry resolved at all ⇒ honest "evidence unavailable".
    //  - registry resolved but this node isn't in it ⇒ honest "not in agent_registry".
    return {
      ...a,
      status: "unavailable" as AgentStatus,
      statusReason: haveEvidence
        ? "No registry evidence for this node (not in agent_registry)."
        : "Registry evidence unavailable — liveness could not be confirmed.",
    };
  });

  const byIdOut: Record<string, MetaAgent> = {};
  for (const a of agents) byIdOut[a.id] = a;
  const counts = {
    total: agents.length,
    cockpitCallable: agents.filter((a) => a.cockpitCallable).length,
    cliOnly: agents.filter((a) => a.cliOnly).length,
    localRunner: agents.filter((a) => a.requiresLocalRunner).length,
    live: agents.filter((a) => a.status === "live").length,
    partial: agents.filter((a) => a.status === "partial").length,
    unavailable: agents.filter((a) => a.status === "unavailable").length,
  };
  return { generatedAt: reg.generatedAt, rootId: reg.rootId, agents, byId: byIdOut, counts };
}
