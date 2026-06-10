/**
 * src/llm/ask-decision-grounding.ts
 *
 * Grounds a strategy / status / daily-brief Ask in the CHIEF-OF-STAFF decision synthesis — so
 * "what should I do today?" is answered with the 2-3 cross-brain-ranked decisions (each with its
 * ask + cost of waiting), not a flat restatement of the present. Mirrors ask-forecast-grounding:
 * a pure enricher applied BETWEEN the Worker building the grounding and composeAskAnswer.
 *
 * Doctrine: PROPOSE, never act. Adds reasoning material (highlights) only; never touches summary/
 * title/proposeOnly, never fabricates (an empty synthesis leaves the grounding byte-identical), and
 * carries confidence verbatim. Worker-safe: composes the same PURE brains the cockpit runs.
 */

import type { AskGrounding } from "./ask-llm.js";
import type { CockpitState } from "../cockpit/cockpit-types.js";
import { strategicAwareness } from "../awareness/strategic-awareness.js";
import { executiveMemory } from "../awareness/executive-memory.js";
import { forecast } from "../prophet/forecast.js";
import { fleetSynthesisView } from "../runtime/views/fleet-synthesis-view.js";
import { synthesizeDecisions } from "../cockpit/decision-synthesis.js";

const DECISION_GROUNDED_INTENTS: ReadonlySet<string> = new Set([
  "system_status",
  "daily_brief",
  "strategy_review",
]);

export interface AugmentDecisionOptions {
  intent?: string;
  request?: string;
  maxDecisions?: number;
}

function isDecisionGroundedIntent(intent: string | undefined): boolean {
  return typeof intent === "string" && DECISION_GROUNDED_INTENTS.has(intent);
}

/**
 * Augment a base grounding with the ranked decision brief. Behaviour-preserving unless the intent
 * is strategy/status/daily AND the synthesis produced at least one decision. Composes the pure
 * brains (strategicAwareness + forecast + executiveMemory + fleetSynthesisView) from `state`, then
 * `synthesizeDecisions`. Pure + deterministic — `now` injected.
 */
export function augmentGroundingWithDecisions(
  grounding: AskGrounding,
  state: CockpitState | undefined,
  now: string,
  opts: AugmentDecisionOptions = {},
): AskGrounding {
  if (!isDecisionGroundedIntent(opts.intent)) return grounding;

  const panels = state?.panels ?? [];
  const proposals = state?.proposalQueue ?? [];
  const snaps = state?.memorySnapshots ?? [];
  const memory = executiveMemory(snaps, { now });
  const fc = forecast({ now, memory: memory.status === "ok" ? memory : null, proposals });
  const brief = strategicAwareness({ now, panels, proposals, ...(snaps.length ? { history: snaps } : {}) });
  const synth = fleetSynthesisView(state, now);
  const crossAgentRisks = synth.available
    ? synth.topRisks.map((r) => ({ subject: r.subject, sources: r.sources, confidence: String(r.confidence) }))
    : [];

  const dec = synthesizeDecisions(
    { now, brief, forecast: fc, memory, crossAgentRisks },
    { max: Math.max(1, opts.maxDecisions ?? 3) },
  );
  if (dec.status !== "ok" || dec.decisions.length === 0) return grounding;

  const baseHighlights = Array.isArray(grounding.highlights) ? grounding.highlights : [];
  const decHighlights = [
    "Top decisions today (ranked by cross-brain corroboration):",
    ...dec.decisions.map(
      (d, i) =>
        `${i + 1}. ${d.title} — do: ${d.theAsk} · cost of waiting: ${d.costOfInaction} ` +
        `[${d.leverage}/${d.horizon}; corroborated by ${d.corroboration.join(", ")}]`,
    ),
  ];
  const highlights = [...baseHighlights, ...decHighlights.filter((h) => !baseHighlights.includes(h))];
  return { ...grounding, highlights };
}
