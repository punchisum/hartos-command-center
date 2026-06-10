/**
 * src/cockpit/knowledge-surface.ts — the unified "Knowledge & Intelligence" cockpit surface.
 *
 * Links everything the fleet now produces into ONE cockpit read-model: the vault dossiers (research
 * + capability scouts), Beezulbub's scout risk, Wolverine's immune verdict, and Prophet's forecast.
 * Pure + deterministic + Worker-safe (types only; no fs / clock / network) — the host gathers the
 * inputs and a renderer/Worker view presents it. Honesty floor: every number is earned by a supplied
 * input; nothing is invented, and an empty surface says so plainly.
 */

import type { WolverineReport, SystemVerdict } from "../wolverine/wolverine-types.js";
import type { ForecastReport, ForecastVerdict } from "../prophet/forecast.js";
import type { CapabilityScoutSummary } from "../beezulbub/scout-summary.js";

/** A filed knowledge note projected for the surface (title + kind + confidence + day). */
export interface KnowledgeDossier {
  title: string;
  /** e.g. "research_dossier" | "capability_dossier" | other note types. */
  type: string;
  confidence?: string | null;
  /** ISO day the note was created, for recency sorting. */
  day?: string | null;
}

export interface KnowledgeIntel {
  wolverineVerdict: SystemVerdict | null;
  wolverineFindingCount: number | null;
  wolverineTopRisks: string[];
  forecastVerdict: ForecastVerdict | null;
  forecastTop: string[];
}

export interface KnowledgeSurface {
  dossierCount: number;
  byType: Record<string, number>;
  /** Most recent dossiers (capped), newest first. */
  recent: KnowledgeDossier[];
  capabilityScoutCount: number;
  /** Scouts whose top pick is risky-license or stale (the immune concern). */
  riskyScoutCount: number;
  intel: KnowledgeIntel;
  /** Honest one-line headline for the cockpit card. */
  headline: string;
}

export interface KnowledgeSurfaceInput {
  dossiers?: KnowledgeDossier[];
  capabilityScouts?: CapabilityScoutSummary[];
  wolverine?: WolverineReport | null;
  forecast?: ForecastReport | null;
  /** How many recent dossiers to surface (default 5). */
  recentLimit?: number;
}

export function composeKnowledgeSurface(input: KnowledgeSurfaceInput = {}): KnowledgeSurface {
  const dossiers = input.dossiers ?? [];
  const scouts = input.capabilityScouts ?? [];
  const recentLimit = input.recentLimit ?? 5;

  const byType: Record<string, number> = {};
  for (const d of dossiers) byType[d.type] = (byType[d.type] ?? 0) + 1;

  const recent = [...dossiers]
    .sort((a, b) => String(b.day ?? "").localeCompare(String(a.day ?? "")))
    .slice(0, recentLimit);

  const riskyScoutCount = scouts.filter((s) => s.topCandidate && (s.riskyTopLicense || s.staleTop)).length;

  const intel: KnowledgeIntel = {
    wolverineVerdict: input.wolverine?.verdict ?? null,
    wolverineFindingCount: input.wolverine?.findingCount ?? null,
    wolverineTopRisks: (input.wolverine?.topRisks ?? []).slice(0, 3).map((f) => f.title),
    forecastVerdict: input.forecast?.verdict ?? null,
    forecastTop: (input.forecast?.consequences ?? []).slice(0, 3).map((c) => `${c.subject}: ${c.projection}`),
  };

  const parts: string[] = [];
  parts.push(`${dossiers.length} dossier(s)`);
  if (scouts.length) parts.push(`${scouts.length} capability scout(s)${riskyScoutCount ? ` (${riskyScoutCount} risky)` : ""}`);
  if (intel.wolverineVerdict) parts.push(`immune ${intel.wolverineVerdict}`);
  if (intel.forecastVerdict) parts.push(`forecast ${intel.forecastVerdict.toUpperCase()}`);
  const headline =
    dossiers.length || scouts.length || intel.wolverineVerdict || intel.forecastVerdict
      ? `Knowledge & Intelligence — ${parts.join(" · ")}.`
      : "Knowledge & Intelligence — nothing filed yet (run research / beezulbub:hunt to populate).";

  return {
    dossierCount: dossiers.length,
    byType,
    recent,
    capabilityScoutCount: scouts.length,
    riskyScoutCount,
    intel,
    headline,
  };
}

/** Render the surface as cockpit lines (also reusable as a deployed card body). Deterministic. */
export function renderKnowledgeSurface(s: KnowledgeSurface): string[] {
  const out: string[] = [`\n${s.headline}`];

  if (s.dossierCount) {
    const types = Object.entries(s.byType).map(([t, n]) => `${t}: ${n}`).join(" · ");
    out.push(`\nKnowledge (${s.dossierCount}) — ${types}`);
    for (const d of s.recent) out.push(`  • ${d.title}${d.confidence ? ` [${d.confidence}]` : ""}${d.day ? ` (${d.day})` : ""}`);
  }

  if (s.capabilityScoutCount) {
    out.push(`\nCapability scouts: ${s.capabilityScoutCount}${s.riskyScoutCount ? ` · ${s.riskyScoutCount} with a risky/stale top pick` : ""}`);
  }

  const i = s.intel;
  if (i.wolverineVerdict) {
    out.push(`\nImmune (Wolverine): ${i.wolverineVerdict} — ${i.wolverineFindingCount ?? 0} finding(s)`);
    for (const r of i.wolverineTopRisks) out.push(`  ! ${r}`);
  }
  if (i.forecastVerdict) {
    out.push(`\nForecast (Prophet): ${i.forecastVerdict.toUpperCase()}`);
    for (const c of i.forecastTop) out.push(`  → ${c}`);
  }
  return out;
}
