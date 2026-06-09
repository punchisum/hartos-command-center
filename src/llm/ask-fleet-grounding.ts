/**
 * src/llm/ask-fleet-grounding.ts
 *
 * Track A — Ask answer grounding augmented with the cross-agent FLEET SYNTHESIS
 * (3-levels-up master plan Level 3, conversational intelligence).
 *
 * When a user asks a fleet / status / strategy / risk question, the Ask answer
 * should be grounded in the SYNTHESIZED cross-agent top-risks — so BOTH the
 * deterministic answer AND the LLM path (`composeAskAnswer` reasons over the
 * grounding) reflect fleet intelligence. This module enriches the base
 * `AskGrounding` (the reasoning material) with that synthesis, in BETWEEN the
 * Worker building the base grounding and calling `composeAskAnswer`.
 *
 * Doctrine (NON-NEGOTIABLE):
 *   - PROPOSE, NEVER ACT. This is a pure grounding enricher: it adds reasoning
 *     material (highlights/gaps) only. It NEVER executes, approves, or mutates,
 *     and it does not touch `proposeOnly` (the orchestrator keeps that `true`).
 *   - NEVER LAUNDER CONFIDENCE. The synthesis already §19-clamps each risk's
 *     confidence to the weakest contributing band; we surface that band VERBATIM
 *     in the highlight text and never upgrade it.
 *   - NEVER FABRICATE. We only ever surface the REAL `fleetSynthesisView` output.
 *     When synthesis is unavailable OR has no top-risks, NOTHING is appended and
 *     the grounding is returned UNCHANGED (behaviour-preserving). Coverage's
 *     honest absent-sources / blind-spots become gaps so the model is grounded
 *     by what the fleet could NOT see, not just what it could.
 *   - We DO NOT touch `summary` / `title`. The LLM may rewrite the summary; we
 *     only enrich `highlights` / `gaps`, which both the deterministic answer and
 *     the LLM (which reasons over the grounding) are anchored by.
 *
 * Worker-safe: imports the `AskGrounding` TYPE and the pure `fleetSynthesisView`
 * builder ONLY (both already Worker-safe). NO node:fs / node:path / pg /
 * node:crypto VALUE import. Pure + deterministic — `now` is injected.
 */

import type { AskGrounding } from "./ask-llm.js";
import type { CockpitState } from "../cockpit/cockpit-types.js";
import { fleetSynthesisView } from "../runtime/views/fleet-synthesis-view.js";

/**
 * The intents whose Ask answers should be grounded by the cross-agent synthesis.
 * These are the fleet / status / strategy / risk-oriented intents in the hosted
 * intent vocabulary (`CockpitIntent`). Build/research/proposal-management and
 * `unknown` intents are deliberately EXCLUDED — they are not fleet-risk reads, so
 * their grounding is left byte-identical. Kept as plain strings (no value import
 * of the intent type) so this module stays decoupled and Worker-safe.
 */
const FLEET_GROUNDED_INTENTS: ReadonlySet<string> = new Set([
  "system_status",
  "daily_brief",
  "fitness_status",
  "ops_status",
  "freshness_status",
  "strategy_review",
]);

/** Options gating the augmentation. The intent decides whether we enrich at all. */
export interface AugmentGroundingOptions {
  /**
   * The deterministic intent the Ask request routed to (e.g. `result.intent`).
   * Only fleet/status/strategy/risk intents are augmented; anything else (or an
   * absent intent) leaves the grounding byte-identical.
   */
  intent?: string;
  /**
   * The (validated) request text. Accepted for parity with the Worker call site
   * and future intent-agnostic gating; not currently used for matching, so it
   * never changes the output. Kept optional + side-effect-free.
   */
  request?: string;
}

/** Is this an intent we ground with the cross-agent synthesis? */
function isFleetGroundedIntent(intent: string | undefined): boolean {
  return typeof intent === "string" && FLEET_GROUNDED_INTENTS.has(intent);
}

/**
 * Augment a base `AskGrounding` with the cross-agent fleet synthesis.
 *
 * Behaviour-preserving by default: returns the grounding UNCHANGED unless the
 * intent is fleet/status/strategy/risk-oriented AND `fleetSynthesisView(state,
 * now)` is `available` with at least one `topRisks` entry. When it augments, it:
 *
 *   - appends one concise highlight per top correlated risk, of the shape
 *     `Cross-agent risk: <subject> [<sources>] — <confidence>` (the confidence is
 *     the synthesis's §19-clamped band, surfaced verbatim — never laundered up);
 *   - appends the honest coverage as gaps: the named absent sources and the
 *     carried-up blind spots, so the model is grounded by what the fleet could
 *     NOT see.
 *
 * Never fabricates: with no available synthesis, or `topRisks` empty, the
 * grounding is returned UNCHANGED (no invented risks). Pure + deterministic —
 * `now` is injected and `fleetSynthesisView` reads no clock. `summary`/`title`
 * are never modified; existing `highlights`/`gaps` are preserved and only
 * appended to (deduped against what is already present).
 */
export function augmentGroundingWithSynthesis(
  grounding: AskGrounding,
  state: CockpitState | undefined,
  now: string,
  opts: AugmentGroundingOptions = {},
): AskGrounding {
  // Gate 1 — only fleet/status/strategy/risk intents are grounded by synthesis.
  if (!isFleetGroundedIntent(opts.intent)) return grounding;

  // Gate 2 — only the REAL synthesis. Unavailable ⇒ no augmentation (honest).
  const synthesis = fleetSynthesisView(state, now);
  if (!synthesis.available) return grounding;

  // Gate 3 — never fabricate: with no correlated risks there is nothing real to
  // surface, so the grounding is left byte-identical.
  if (synthesis.topRisks.length === 0) return grounding;

  // Build the synthesized highlights — one per top risk, confidence VERBATIM.
  const baseHighlights = Array.isArray(grounding.highlights) ? grounding.highlights : [];
  const synthHighlights: string[] = [];
  for (const risk of synthesis.topRisks) {
    const sources = risk.sources.join(", ");
    synthHighlights.push(`Cross-agent risk: ${risk.subject} [${sources}] — ${risk.confidence}`);
  }
  const highlights = [
    ...baseHighlights,
    ...synthHighlights.filter((h) => !baseHighlights.includes(h)),
  ];

  // Build the honest coverage gaps — named absent sources + carried-up blind
  // spots, so the model reasons over what the fleet could NOT see.
  const baseGaps = Array.isArray(grounding.gaps) ? grounding.gaps : [];
  const synthGaps: string[] = [];
  for (const absent of synthesis.coverage.absentSources) {
    synthGaps.push(`Fleet coverage gap: ${absent} signal absent from this synthesis`);
  }
  for (const blind of synthesis.coverage.blindSpots) {
    synthGaps.push(`Fleet blind spot: ${blind}`);
  }
  const gaps = [...baseGaps, ...synthGaps.filter((g) => !baseGaps.includes(g))];

  // Enrich ONLY highlights/gaps; summary/title are untouched (the LLM may
  // rewrite the summary, but its reasoning is anchored by these facts).
  return { ...grounding, highlights, gaps };
}
