/**
 * src/llm/ask-forecast-grounding.ts
 *
 * Track A (forward-tense) — Ask answer grounding augmented with PROPHET's
 * consequence-of-inaction forecast.
 *
 * The fleet synthesis (ask-fleet-grounding) grounds the Ask in PRESENT correlated
 * risks. This module adds the FORWARD-tense layer: when a user asks a fleet /
 * status / strategy / risk question — especially "what's going to bite me?" — the
 * answer should also be grounded in what those known issues BECOME if left alone.
 * It enriches the base `AskGrounding` BETWEEN the Worker building it and calling
 * `composeAskAnswer`, exactly like the synthesis enricher.
 *
 * Doctrine (NON-NEGOTIABLE):
 *   - PROPOSE, NEVER ACT. Pure grounding enricher: adds reasoning material
 *     (highlights/gaps) only. Never executes, approves, mutates, or touches
 *     `proposeOnly`.
 *   - NEVER FABRICATE. Prophet projects only the CONSEQUENCE of issues it can SEE
 *     (from durable memory + the proposal queue here). With no forecastable
 *     consequence (e.g. < 3 memory snapshots, no aging proposals), NOTHING is
 *     appended and the grounding is returned UNCHANGED (behaviour-preserving). The
 *     forecast naturally sharpens as the daily pulse accrues memory.
 *   - NEVER LAUNDER CONFIDENCE. The forecast verdict + each projection are
 *     surfaced verbatim; severities/horizons come straight from Prophet.
 *   - We DO NOT touch `summary` / `title`. The LLM may rewrite the summary; we
 *     only enrich `highlights` (projections) / `gaps` (what Prophet can't foresee).
 *
 * Worker-safe: imports the `AskGrounding` TYPE and the PURE `forecast` /
 * `summarizeForecast` / `executiveMemory` builders ONLY. No node:fs / node:path /
 * pg VALUE import. Pure + deterministic — `now` is injected.
 */

import type { AskGrounding } from "./ask-llm.js";
import type { CockpitState } from "../cockpit/cockpit-types.js";
import { forecast, summarizeForecast } from "../prophet/forecast.js";
import { executiveMemory } from "../awareness/executive-memory.js";

/**
 * The intents whose Ask answers should be grounded by the forward-tense forecast —
 * the same fleet/status/strategy/risk family the synthesis enricher grounds. Plain
 * strings (no value import of the intent type) so this stays Worker-safe + decoupled.
 */
const FORECAST_GROUNDED_INTENTS: ReadonlySet<string> = new Set([
  "system_status",
  "daily_brief",
  "fitness_status",
  "ops_status",
  "freshness_status",
  "strategy_review",
]);

/** Options gating the augmentation. The intent decides whether we enrich at all. */
export interface AugmentForecastOptions {
  /** The deterministic intent the Ask routed to; only forward-looking intents are augmented. */
  intent?: string;
  /** Accepted for call-site parity; not used for matching (never changes output). */
  request?: string;
  /** How many top consequences to surface as highlights (default 3). */
  maxConsequences?: number;
}

function isForecastGroundedIntent(intent: string | undefined): boolean {
  return typeof intent === "string" && FORECAST_GROUNDED_INTENTS.has(intent);
}

/**
 * Augment a base `AskGrounding` with Prophet's consequence-of-inaction forecast.
 *
 * Behaviour-preserving by default: returns the grounding UNCHANGED unless the intent
 * is forward-looking AND `forecast(...)` over the durable memory + proposal queue
 * yields at least one consequence. When it augments, it:
 *   - prepends the forecast verdict as a highlight (`Forecast: <verdict> — <summary>`);
 *   - appends the top-N consequence projections (severity-ranked by Prophet) as
 *     highlights, verbatim;
 *   - appends Prophet's blind spots (what it explicitly cannot foresee) as gaps.
 *
 * Never fabricates: with no memory/proposals signal there are no consequences, so the
 * grounding is byte-identical. Pure + deterministic — `now` injected.
 */
export function augmentGroundingWithForecast(
  grounding: AskGrounding,
  state: CockpitState | undefined,
  now: string,
  opts: AugmentForecastOptions = {},
): AskGrounding {
  // Gate 1 — only forward-looking intents are grounded by the forecast.
  if (!isForecastGroundedIntent(opts.intent)) return grounding;

  // Build Prophet's forward-tense inputs from the Worker-available, time-aware signals:
  // durable Executive Memory (the only input that sees across time) + the proposal queue
  // (aging pending decisions). Both pure; no perception/plan needed for a real forecast.
  const snapshots = state?.memorySnapshots ?? [];
  const memory = snapshots.length ? executiveMemory(snapshots, { now }) : null;
  const report = forecast({ now, memory, proposals: state?.proposalQueue ?? [] });

  // Gate 2 — never fabricate: no projected consequence ⇒ nothing to add (honest).
  if (report.consequences.length === 0) return grounding;

  const max = Math.max(1, opts.maxConsequences ?? 3);
  const baseHighlights = Array.isArray(grounding.highlights) ? grounding.highlights : [];
  const forecastHighlights: string[] = [`Forecast: ${summarizeForecast(report)}`];
  for (const c of report.consequences.slice(0, max)) {
    forecastHighlights.push(`Consequence of inaction — ${c.subject} (${c.severity}/${c.horizon}): ${c.projection}`);
  }
  const highlights = [...baseHighlights, ...forecastHighlights.filter((h) => !baseHighlights.includes(h))];

  // Honest coverage — what Prophet explicitly cannot foresee becomes a gap.
  const baseGaps = Array.isArray(grounding.gaps) ? grounding.gaps : [];
  const forecastGaps = report.blindSpots.map((b) => `Prophet cannot foresee: ${b}`);
  const gaps = [...baseGaps, ...forecastGaps.filter((g) => !baseGaps.includes(g))];

  return { ...grounding, highlights, gaps };
}
