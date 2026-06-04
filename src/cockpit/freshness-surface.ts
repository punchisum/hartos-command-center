/**
 * src/cockpit/freshness-surface.ts
 *
 * Phase 15C — Freshness + Sync Control Surface.
 *
 * A PURE, read-only roll-up of data freshness across the Fitness, Ops, and
 * Factory domains, plus a ClickUp import/sync health view derived from the Ops
 * read-model. It turns the per-domain source freshness + diagnostics into an
 * operator-grade Green / Amber / Red verdict with a stale reason and a SAFE next
 * step.
 *
 * Hard boundaries (Phase 15C):
 *   - No execution. It NEVER triggers a ClickUp import, never mutates a provider,
 *     never writes. It only describes freshness and the safe manual next step.
 *   - It invents nothing: missing values stay null and are reported as gaps.
 */

import type { DomainPanel, PanelField } from "./panels/index.js";
import type { SourceDiagnosticsReport, DomainSourceDiag } from "./sources/index.js";
import type { Freshness } from "./sources/source-types.js";
import { worstFreshness, DEFAULT_FRESHNESS } from "./sources/freshness.js";

export type FreshnessVerdict = "green" | "amber" | "red";

/** Operator-facing per-domain freshness state. */
export type DomainFreshnessState = "fresh" | "stale" | "reports_only" | "unavailable";

export type FreshnessDomain = "fitness" | "ops" | "factory";

export interface DomainFreshness {
  domain: FreshnessDomain;
  state: DomainFreshnessState;
  freshness: Freshness;
  lastUpdated: string | null;
  resolvedFields: number;
  /** Why this domain is in its current state (no secrets). */
  reason: string;
  /** Exact safe next step to refresh/repair this domain, else null. */
  safeNextStep: string | null;
}

/** ClickUp import / sync health, derived from the Ops read-model (read-only). */
export interface ClickUpSyncHealth {
  /** Latest successful import / activity timestamp, if available. */
  lastImportAt: string | null;
  /** Latest import / sync status line, if the read-model surfaced one. */
  importStatus: string | null;
  /** Cards imported (active cards), if available. */
  cardsImported: string | null;
  /** Updates imported count, if available. */
  updatesImported: string | null;
  /** True when the latest activity is older than the freshness window. */
  stale: boolean;
}

export interface FreshnessReport {
  verdict: FreshnessVerdict;
  verdictReason: string;
  /** Latest read-model check time (diagnostics generation), else the supplied now. */
  generatedAt: string;
  domains: DomainFreshness[];
  staleDomains: FreshnessDomain[];
  unavailableDomains: FreshnessDomain[];
  clickup: ClickUpSyncHealth;
  /** Operator explanation of WHY things are stale (ops-focused), else null. */
  staleReason: string | null;
  /** The single safest manual next step. Never executes. */
  safeNextStep: string;
  /** Human label for the freshness window (e.g. "24h"). */
  windowLabel: string;
}

export interface FreshnessInputs {
  panels: DomainPanel[];
  diagnostics?: SourceDiagnosticsReport;
  now: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function panelById(panels: DomainPanel[], id: DomainPanel["id"]): DomainPanel | undefined {
  return panels.find((p) => p.id === id);
}

/**
 * Meta fields are always present and "ok" (panel status + derived next action);
 * they are NOT resolved data, so they must not count toward freshness/coverage.
 */
const META_FIELD_KEYS = new Set(["status", "next_action"]);

function okFields(panel: DomainPanel | undefined): PanelField[] {
  return (panel?.fields ?? []).filter((f) => f.status === "ok" && !META_FIELD_KEYS.has(f.key));
}

function panelFreshness(panel: DomainPanel | undefined): Freshness {
  const fresh = okFields(panel)
    .map((f) => f.freshness)
    .filter((f): f is Freshness => !!f);
  return worstFreshness(fresh);
}

/** Latest known timestamp across a panel's resolved fields. */
function panelLastUpdated(panel: DomainPanel | undefined, keys?: string[]): string | null {
  const fields = okFields(panel).filter((f) => (keys ? keys.includes(f.key) : true));
  const stamps = fields.map((f) => f.lastUpdated).filter((x): x is string => !!x).sort();
  return stamps.length ? stamps[stamps.length - 1]! : null;
}

function fieldValue(panel: DomainPanel | undefined, key: string): string | null {
  const f = panel?.fields.find((x) => x.key === key);
  return f && f.status === "ok" ? f.value : null;
}

function windowLabel(): string {
  const hours = Math.round(DEFAULT_FRESHNESS.freshMaxAgeMs / 3_600_000);
  return `${hours}h`;
}

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function joinClauses(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Map a read-model domain diagnostic + freshness into an operator state. */
function deriveReadModelState(diag: DomainSourceDiag | undefined, freshness: Freshness, resolvedFields: number): DomainFreshnessState {
  if (resolvedFields === 0) return "unavailable";
  switch (diag?.status) {
    case "live":
      return freshness === "stale" ? "stale" : "fresh";
    case "stale":
      return "stale";
    case "reports_only":
      return freshness === "stale" ? "stale" : "reports_only";
    case "disabled":
    case "missing_env":
    case "not_configured":
    case "rejected_unsafe":
    case "unavailable":
      return "unavailable";
    default:
      return freshness === "stale" ? "stale" : "fresh";
  }
}

/** Factory has no read-model — its healthy state is fresh local reports. */
function deriveFactoryState(freshness: Freshness, resolvedFields: number): DomainFreshnessState {
  if (resolvedFields === 0) return "unavailable";
  return freshness === "stale" ? "stale" : "fresh";
}

function domainEntry(
  domain: FreshnessDomain,
  panel: DomainPanel | undefined,
  diag: DomainSourceDiag | undefined
): DomainFreshness {
  const resolvedFields = diag?.resolvedFields ?? okFields(panel).length;
  const freshness = diag?.freshness ?? panelFreshness(panel);
  const lastUpdated = panelLastUpdated(panel);
  const state =
    domain === "factory"
      ? deriveFactoryState(freshness, resolvedFields)
      : deriveReadModelState(diag, freshness, resolvedFields);

  let reason: string;
  let safeNextStep: string | null;
  switch (state) {
    case "fresh":
      reason = diag?.note ?? "Live, current data.";
      safeNextStep = null;
      break;
    case "stale":
      reason =
        domain === "ops"
          ? `Latest activity${lastUpdated ? ` (${lastUpdated})` : ""} is older than the ${windowLabel()} freshness window.`
          : `Latest ${domain} data${lastUpdated ? ` (${lastUpdated})` : ""} is older than the ${windowLabel()} freshness window.`;
      safeNextStep =
        domain === "ops"
          ? "Re-run the ClickUp import manually, then re-check ops status."
          : diag?.setupStep ?? `Refresh the ${domain} data source, then re-run \`npm run read-models:status\`.`;
      break;
    case "reports_only":
      reason = diag?.note ?? "Running on local reports/handover only — no live read-model.";
      safeNextStep = diag?.setupStep ?? `Enable a live ${domain} read-model in read-models.local.json.`;
      break;
    case "unavailable":
    default:
      reason = diag?.note ?? `No usable ${domain} data resolved.`;
      safeNextStep = diag?.setupStep ?? `Configure the ${domain} data source.`;
      break;
  }
  return { domain, state, freshness, lastUpdated, resolvedFields, reason, safeNextStep };
}

// ─── verdict ─────────────────────────────────────────────────────────────────

/**
 * Pure verdict from the per-domain states. Ops is the critical domain: if it has
 * no usable data the whole picture is RED (you can't trust operations). Any other
 * non-fresh signal is AMBER. All fresh → GREEN.
 */
export function computeFreshnessVerdict(domains: DomainFreshness[]): { verdict: FreshnessVerdict; verdictReason: string } {
  const ops = domains.find((d) => d.domain === "ops");
  if (!ops || ops.state === "unavailable") {
    return {
      verdict: "red",
      verdictReason: ops
        ? "Ops read-model is unavailable — operational data can't be trusted."
        : "Ops freshness could not be resolved — operational data can't be trusted.",
    };
  }

  const attention = domains.filter((d) => d.state !== "fresh");
  if (attention.length === 0) {
    return { verdict: "green", verdictReason: "All domains have fresh, live data." };
  }

  const stale = domains.filter((d) => d.state === "stale").map((d) => d.domain);
  const degraded = domains.filter((d) => d.state === "reports_only" || d.state === "unavailable").map((d) => d.domain);
  const parts: string[] = [];
  if (stale.length) parts.push(`${stale.join(", ")} ${stale.length > 1 ? "are" : "is"} stale`);
  if (degraded.length) parts.push(`${degraded.join(", ")} ${degraded.length > 1 ? "are" : "is"} not on live data`);
  return { verdict: "amber", verdictReason: `${capitalize(joinClauses(parts))}.` };
}

// ─── public entry point ──────────────────────────────────────────────────────

export function buildFreshnessReport(inputs: FreshnessInputs): FreshnessReport {
  const { panels, diagnostics } = inputs;
  const generatedAt = diagnostics?.generatedAt ?? inputs.now;

  const diagByDomain = new Map<string, DomainSourceDiag>((diagnostics?.domains ?? []).map((d) => [d.domain, d]));
  const fitness = domainEntry("fitness", panelById(panels, "fitness"), diagByDomain.get("fitness"));
  const ops = domainEntry("ops", panelById(panels, "ops"), diagByDomain.get("ops"));
  const factory = domainEntry("factory", panelById(panels, "factory"), diagByDomain.get("factory"));
  const domains = [fitness, ops, factory];

  const { verdict, verdictReason } = computeFreshnessVerdict(domains);

  // ── ClickUp import / sync health from the Ops panel (read-only) ──
  const opsPanel = panelById(panels, "ops");
  const lastImportAt = panelLastUpdated(opsPanel, ["clickup_sync", "latest_updates", "recent_updates", "active_cards"]);
  const syncValue = fieldValue(opsPanel, "clickup_sync");
  // Only surface a genuine sync-status line (e.g. "Latest sync: ok at …"), not the
  // "<N> cards imported" count fallback (already covered by cardsImported).
  const importStatus =
    syncValue && /sync|status|ok|fail|error|run/i.test(syncValue) && !/^\d+\s+cards?\s+imported/i.test(syncValue.trim())
      ? syncValue
      : null;
  const clickup: ClickUpSyncHealth = {
    lastImportAt,
    importStatus,
    cardsImported: fieldValue(opsPanel, "active_cards"),
    updatesImported: null, // no updates-count field is currently surfaced read-only
    stale: ops.state === "stale",
  };

  const staleDomains = domains.filter((d) => d.state === "stale").map((d) => d.domain);
  const unavailableDomains = domains.filter((d) => d.state === "unavailable").map((d) => d.domain);

  // ── ops-focused stale reason ──
  let staleReason: string | null = null;
  if (ops.state === "stale") {
    staleReason = `Ops is stale: the latest ClickUp activity/import${lastImportAt ? ` (${lastImportAt})` : " timestamp is unknown"} is older than the ${windowLabel()} freshness window.`;
  } else if (ops.state === "unavailable") {
    staleReason = `Ops data is unavailable: ${ops.reason}`;
  } else if (staleDomains.length) {
    staleReason = `${capitalize(joinClauses(staleDomains))} ${staleDomains.length > 1 ? "are" : "is"} stale (older than the ${windowLabel()} freshness window).`;
  }

  // ── single safest manual next step ──
  let safeNextStep: string;
  if (ops.state === "stale") {
    safeNextStep = "Re-run the ClickUp import manually, then re-check ops status. Until then, don't make important ops decisions from stale data.";
  } else if (ops.safeNextStep) {
    safeNextStep = ops.safeNextStep;
  } else {
    const firstAttention = domains.find((d) => d.safeNextStep);
    safeNextStep = firstAttention?.safeNextStep ?? "Nothing to refresh — data is current.";
  }

  return {
    verdict,
    verdictReason,
    generatedAt,
    domains,
    staleDomains,
    unavailableDomains,
    clickup,
    staleReason,
    safeNextStep,
    windowLabel: windowLabel(),
  };
}
