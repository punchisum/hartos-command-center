/**
 * src/cockpit/suggestions/synthesis-suggestions.ts — TRACK B: the CROSS-AGENT action surface.
 *
 * `suggest-actions.ts` builds the cockpit's ranked "do next" list from SINGLE-SOURCE signals
 * (one perception observation, one forecast consequence, one orchestrator deferral, the coach,
 * the triage). It cannot, by construction, see a risk that ONLY emerges when two brains agree —
 * a subject flagged by perception AND forecast AND/OR the briefing. That cross-agent correlation
 * is exactly what `fleet-synthesis.ts` (`synthesizeFleet`) computes: the top CORRELATED risks,
 * each naming its contributing `sources` with an HONEST, no-laundering confidence band.
 *
 * This module is the bridge: it maps those CORRELATED (multi-source) synthesis risks into
 * `SuggestedAction`s of the EXACT same shape `suggest-actions.ts` emits, so they flow through the
 * existing suggestion → proposal → mutate path (via `suggestionToProposal` / the mutation mapper
 * `suggestionToMutationProposal`). The value it adds over single-source suggestions:
 *
 *   • it ONLY emits for risks with `sources.length > 1` — the cross-agent insight a single-source
 *     pass cannot produce. A single-source synthesis risk is, by definition, already covered by the
 *     perception/forecast suggestion `suggest-actions.ts` itself produces, so re-emitting it would
 *     just duplicate — we DROP it (documented below). This is both the unique value AND the dedup
 *     story: cross-agent items are net-new; single-source items defer to the existing pass.
 *
 * Doctrine (NON-NEGOTIABLE, mirrors fleet-synthesis + suggest-actions):
 *   • PROPOSE-ONLY: a `SuggestedAction` is an advisory candidate. It maps through
 *     `suggestionToProposal` / `suggestionToMutationProposal`, both of which yield
 *     `executable:false`, `requiredApproval:"Hart"`, `status:"draft"`. NOTHING here executes or
 *     approves; the human-approval floor never moves.
 *   • NEVER LAUNDER CONFIDENCE / NEVER INFLATE PRIORITY: priority is derived monotonically from the
 *     risk's already-§19-clamped `severity` (and never bumped by confidence). A synthesized risk
 *     keeps the WEAKEST band fleet-synthesis already assigned it; we read that band, we never raise it.
 *   • NEVER FABRICATE: empty / unavailable synthesis (no correlated risks) ⇒ `[]`. The rationale is
 *     built from the risk's real `why` + its real contributing sources, never invented.
 *
 * PURE + deterministic + Worker-safe: no fs / network / clock / env, no Node-only import. It
 * composes already-Worker-surfaced read models (the `FleetSynthesis` rollup) and emits plain data.
 * `import type` only for the heavy upstream modules so a read-only Worker bundle stays clean.
 */

import type {
  SuggestedAction,
  SuggestionPriority,
} from "./suggest-actions.js";
import type { FleetSynthesis, FleetRisk, FleetSource } from "../../fleet/fleet-synthesis.js";
import type { ProposalDomain, ProposalActionType } from "../proposals/proposal-types.js";

/**
 * Distinct id prefix so synthesis ids can NEVER collide with the `suggest-actions.ts` scheme
 * (`sg-<source>-<title-slug>`). Synthesis ids are `sx-syn-<subject-token>`: a different namespace
 * (`sx-` vs `sg-`) AND keyed on the TRUSTED correlation subject token, not free text — so they
 * dedupe STABLY across bakes and never accidentally equal a single-source suggestion's id.
 */
export const SYNTHESIS_ID_PREFIX = "sx-syn" as const;

export interface SynthesisSuggestionOptions {
  /**
   * Max correlated suggestions to surface. Default 6 (matches `suggest-actions.ts`'s cap so the
   * merged list stays a focused "do next", not a dump). The synthesis rollup is already ranked
   * (severity desc → corroboration desc → subject), so we take the top N of the correlated subset.
   */
  limit?: number;
}

// ─── severity (0–3, fleet-synthesis scale) → suggestion priority (honest, no inflation) ──
//
// Monotonic and conservative: a higher severity never maps to a LOWER priority, and we never
// promote past what the severity warrants. sev 3 (critical/urgent) → high; sev 2 (warn/red/
// stale) → medium; sev 0–1 (info/amber/green) → low. Confidence does NOT enter this mapping —
// priority reflects how BAD the risk is, while the §19-clamped confidence band rides along in the
// rationale (we surface it honestly without letting it inflate the priority).
const PRIORITY_BY_SEVERITY: Record<FleetRisk["severity"], SuggestionPriority> = {
  3: "high",
  2: "medium",
  1: "low",
  0: "low",
};

/**
 * The correlation subject is a normalized domain/entity token (e.g. "ops", "fitness", "clickup",
 * "proposals", "fleet capability") — produced by fleet-synthesis's `correlationKey`. Map it to the
 * proposal `domain` enum the rest of the pipeline understands. Conservative + honest: anything we
 * cannot confidently place lands in "system" (the cross-cutting bucket), never a wrong specific
 * domain. Mirrors the subject→domain logic in suggest-actions.ts so a synthesis suggestion agrees
 * with a single-source one about the same subject.
 */
function domainForSubject(subject: string): ProposalDomain {
  const s = subject.toLowerCase();
  if (s.includes("fitness")) return "fitness";
  if (s.includes("clickup") || s.includes("ops")) return "ops";
  if (s.includes("factory") || s.includes("agent")) return "factory";
  // "fleet", "fleet capability", "proposals", anything cross-cutting → system.
  return "system";
}

/**
 * Map the subject's domain to the proposal `actionType` the pipeline recognizes. We deliberately
 * choose the SAME action types suggest-actions.ts uses for the equivalent subject so the merged
 * list reads consistently and the mutation mapper classifies them identically: a capability/fleet
 * subject is a build plan; fitness is a fitness adjustment; ops/system default to a sync-repair
 * plan (the queue/sync hygiene action the mutation mapper can recognize for the `system` domain).
 */
function actionTypeForSubject(subject: string, domain: ProposalDomain): ProposalActionType {
  const s = subject.toLowerCase();
  if (s.includes("capability")) return "build_agent_plan";
  if (domain === "fitness") return "fitness_adjustment_plan";
  if (domain === "ops") return "ops_followup_plan";
  // system / factory cross-cutting correlated risks → sync/queue repair plan.
  return "sync_repair_plan";
}

/** Stable, collision-proof id from the TRUSTED subject token (never free text). */
function synthesisId(subject: string): string {
  const token = subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
  return `${SYNTHESIS_ID_PREFIX}-${token}`.slice(0, 90);
}

/** A human, present-tense action title for a correlated risk about `subject`. */
function titleForSubject(subject: string): string {
  return `Address the cross-agent risk on "${subject}"`;
}

/**
 * Build the rationale HONESTLY from the risk's own evidence: name the contributing sources (the
 * cross-agent corroboration that makes this net-new vs single-source suggestions), the §19-clamped
 * confidence band (surfaced, never used to inflate priority), and the composed `why`. Never invents.
 */
function rationaleFor(risk: FleetRisk): string {
  const sources = risk.sources.join(" + ");
  const why = risk.why.trim();
  const base = `Correlated across ${sources} (confidence: ${risk.confidence}).`;
  return why ? `${base} ${why}` : base;
}

/**
 * PURE. Turn a `FleetSynthesis` rollup into `SuggestedAction[]`.
 *
 * Emits ONE suggestion per CORRELATED top-risk (`sources.length > 1`) — the cross-agent insights a
 * single-source `suggestActions` pass cannot produce. SINGLE-SOURCE risks are DROPPED on purpose:
 * they are already covered by the perception/forecast/etc. suggestions `suggest-actions.ts` emits,
 * so re-emitting them would duplicate (this is the dedup story). Empty / unavailable synthesis
 * (no correlated risks, or no rollup at all) ⇒ `[]` (no fabrication).
 *
 * The output is a list of advisory `SuggestedAction`s of the EXACT shape `suggest-actions.ts`
 * produces, so the Commander can fold them into the same ranked/de-duplicated pipeline and they map
 * through `suggestionToProposal` / `suggestionToMutationProposal` (both yield `executable:false`).
 *
 * `source` is set to `"orchestrator"` — the FLEET-LEVEL source in the shared `SuggestionSource`
 * union. A cross-agent corroborated risk is precisely the fleet orchestration view, and that source
 * carries the highest rank weight in suggest-actions.ts, which correctly floats a multi-source
 * corroborated item to the top of the merged list. (The closed union has no dedicated "synthesis"
 * member; the DISTINCT id prefix — not the source — is what guarantees no id collision + stable dedup.)
 *
 * Deterministic: same `synthesis` + same `opts` ⇒ deep-equal `SuggestedAction[]`. No I/O.
 */
export function suggestionsFromSynthesis(
  synthesis: FleetSynthesis | null | undefined,
  opts: SynthesisSuggestionOptions = {},
): SuggestedAction[] {
  if (!synthesis || synthesis.topRisks.length === 0) return [];
  const limit = opts.limit ?? 6;

  const out: SuggestedAction[] = [];
  for (const risk of synthesis.topRisks) {
    // CROSS-AGENT only: a single-source risk is already covered by suggest-actions.ts — drop it.
    if (risk.sources.length <= 1) continue;
    // Cap BEFORE pushing so limit:0 yields [] and limit:N yields exactly N (no off-by-one).
    if (out.length >= limit) break;

    const domain = domainForSubject(risk.subject);
    const actionType = actionTypeForSubject(risk.subject, domain);
    out.push({
      id: synthesisId(risk.subject),
      domain,
      actionType,
      title: titleForSubject(risk.subject),
      rationale: rationaleFor(risk),
      // Fleet-level source — see the doc comment above for why this is the honest choice.
      source: "orchestrator",
      // Honest priority straight from the §19-clamped severity — never inflated by confidence.
      priority: PRIORITY_BY_SEVERITY[risk.severity],
    });
  }

  // The synthesis rollup is already ranked (severity desc → corroboration desc → subject), and we
  // preserve that order, so the emitted list is deterministic without a re-sort.
  return out;
}
