/**
 * src/cockpit/panels/panel-types.ts
 *
 * Phase 12A — Domain Panel Contract.
 *
 * A domain panel is a read-only, agent-specific view rendered in the local
 * cockpit. Panels turn the generic "agent ok" cards into useful domain-specific
 * summaries (Fitness, Ops, Factory). They are built from the existing read-only
 * boundaries ONLY (agent integration read-models, Supabase read-models, local
 * reports, capability registry) and degrade gracefully:
 *
 *   - They NEVER show fake data.
 *   - When a field is unavailable they show `unknown`, `not configured`, or
 *     `no data found`, plus the EXACT next setup step.
 *   - They carry source metadata, freshness, and confidence where possible.
 *   - They are READ-ONLY. No execution, no mutation, no network beyond the
 *     already-governed read-only boundaries.
 *
 * Phase 13 — fields now carry the shared freshness model (fresh/stale/unknown)
 * plus `lastUpdated`, sourced from the read-only source layer.
 */

import type { Freshness, SourceValue } from "../sources/source-types.js";

export type DomainPanelId = "fitness" | "ops" | "factory";

/**
 * Panel-level status.
 *   available    — module/surface is present and usable (e.g. the Factory).
 *   detected     — configured AND real local sources were detected.
 *   configured   — configured but no live data detected yet (degraded).
 *   unconfigured — not configured at all (needs setup).
 *   unavailable  — should exist but is missing/errored.
 */
export type DomainPanelStatus =
  | "available"
  | "detected"
  | "configured"
  | "unconfigured"
  | "unavailable";

/**
 * Per-field availability.
 *   ok             — a real value was found.
 *   unknown        — the value could not be derived from available sources.
 *   not_configured — the source that would provide it is not configured.
 *   no_data        — the source is configured but returned nothing.
 */
export type PanelFieldStatus = "ok" | "unknown" | "not_configured" | "no_data";

export type PanelConfidence = "low" | "medium" | "high";

/** Human-readable placeholders — never invent a real value. */
export const FIELD_UNKNOWN = "unknown";
export const FIELD_NOT_CONFIGURED = "not configured";
export const FIELD_NO_DATA = "no data found";

export interface PanelField {
  key: string;
  label: string;
  /** Real value, or one of the placeholder constants above. */
  value: string;
  status: PanelFieldStatus;
  /** Where the value (or its absence) was derived from. */
  source?: string;
  /** ISO timestamp of the underlying datum, when known. */
  lastUpdated?: string | null;
  /** Phase 13E freshness verdict (fresh/stale/unknown). */
  freshness?: Freshness;
  confidence?: PanelConfidence;
  /** Exact next setup step shown when the field is unavailable. */
  setupStep?: string;
}

/**
 * The domain's headline advisory (coach verdict / triage verdict), in a structured
 * form the cross-system synthesis can consume — so "do next" can include the top
 * fitness + ops action, not just the cross-system ones. `act` is true only when the
 * verdict calls for a change worth surfacing.
 */
export interface PanelAdvisory {
  verdict: string;
  priority: PanelConfidence;
  act: boolean;
  headline: string;
}

export interface DomainPanel {
  id: DomainPanelId;
  title: string;
  status: DomainPanelStatus;
  /** True when real local/source data backs at least one field. */
  detected: boolean;
  /** Grounded one-line summary. Never invents operational facts. */
  summary: string;
  fields: PanelField[];
  /** Notable, real signals worth surfacing first. */
  highlights: string[];
  /** Known gaps (missing sources / unavailable fields). */
  gaps: string[];
  /** The single most useful next action for this domain. */
  nextAction: string;
  /** Exact setup steps to make the panel more useful (empty when fully set up). */
  missingSetupSteps: string[];
  /** Source paths / boundaries the panel read from. */
  sources: string[];
  confidence: PanelConfidence;
  /** Headline coach/triage verdict for the cross-system synthesis (when applicable). */
  advisory?: PanelAdvisory;
  generatedAt: string;
}

// ─── Field helpers ──────────────────────────────────────────────────────────

/** Build a field that holds a real, found value. */
export function okField(
  key: string,
  label: string,
  value: string,
  opts: { source?: string; lastUpdated?: string | null; freshness?: Freshness; confidence?: PanelConfidence } = {}
): PanelField {
  return {
    key,
    label,
    value,
    status: "ok",
    ...(opts.source ? { source: opts.source } : {}),
    ...(opts.lastUpdated !== undefined ? { lastUpdated: opts.lastUpdated } : {}),
    ...(opts.freshness ? { freshness: opts.freshness } : {}),
    ...(opts.confidence ? { confidence: opts.confidence } : {}),
  };
}

/** Build an `ok` field directly from a resolved SourceValue (carries provenance). */
export function fieldFromSource(key: string, label: string, sv: SourceValue): PanelField {
  return {
    key,
    label,
    value: sv.value,
    status: "ok",
    source: sv.source,
    lastUpdated: sv.lastUpdated,
    freshness: sv.freshness,
    confidence: sv.confidence,
  };
}

/**
 * Build an unavailable field. `status` selects the placeholder value so the UI
 * never shows a fabricated number — only `unknown` / `not configured` /
 * `no data found`, plus the exact next setup step.
 */
export function unavailableField(
  key: string,
  label: string,
  status: Exclude<PanelFieldStatus, "ok">,
  setupStep: string,
  source?: string
): PanelField {
  const value =
    status === "not_configured"
      ? FIELD_NOT_CONFIGURED
      : status === "no_data"
        ? FIELD_NO_DATA
        : FIELD_UNKNOWN;
  return {
    key,
    label,
    value,
    status,
    setupStep,
    ...(source ? { source } : {}),
    confidence: "low",
  };
}

/** True when the field carries a real value. */
export function isFieldAvailable(field: PanelField): boolean {
  return field.status === "ok";
}
