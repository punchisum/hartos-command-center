/**
 * src/prophet/forecast.ts
 *
 * Phase F5 — Prophet's deterministic core: the CONSEQUENCE-OF-INACTION forecast.
 *
 * Prophet does NOT predict the world. It projects the logical CONSEQUENCE of leaving
 * KNOWN issues unaddressed — "if ops stays stale, every ops decision stays wrong; it
 * doesn't heal on its own." That's an entailment from observed evidence, not a
 * psychic guess, so it never fabricates. Its distinctive value over perception
 * (present-tense "what's wrong now") is forward-tense: it reads the ORCHESTRATOR's
 * deferrals and says when the fleet stops keeping up — "work is arriving with no path
 * to completion; the backlog grows until you add an agent / capacity." That ties the
 * whole F-chain (research → perception → fleet → orchestration) into a single
 * "what happens if you do nothing" answer.
 *
 * Pure, fs/network-free, deterministic. Honest about scope: it can only forecast the
 * consequences of issues it can SEE — it carries perception's blind spots forward as
 * things it explicitly cannot foresee.
 */

import type { PerceptionReport } from "../rinnegan/perception.js";
import type { FleetPlan } from "../fleet/orchestrator.js";
import type { ProposalQueueItem } from "../cockpit/proposals/proposal-types.js";
// Type-only (erased at runtime → no module cycle): the two newest knowledge-loop signals
// Prophet now projects from — the immune system's findings and the memory layer's trends.
import type { WolverineReport, WolverineCategory } from "../wolverine/wolverine-types.js";
import type { ExecutiveMemoryReport, MemoryTrend } from "../awareness/executive-memory.js";
import type { CapabilityScoutSummary } from "../beezulbub/scout-summary.js";

export type ForecastSeverity = "low" | "medium" | "high";
export type ForecastHorizon = "now" | "days" | "week+";
export type ForecastVerdict = "stable" | "degrading" | "urgent";

export interface Consequence {
  subject: string;
  /** The entailed consequence of inaction (projected, never fabricated). */
  projection: string;
  severity: ForecastSeverity;
  /** When it bites (deterministic bucket). */
  horizon: ForecastHorizon;
  /** The observed evidence this projects from. */
  basis: string;
  /** The action that prevents it. */
  preventedBy: string;
}

export interface ForecastReport {
  verdict: ForecastVerdict;
  /** Severity-ranked consequences of leaving the known issues unaddressed. */
  consequences: Consequence[];
  /** Honest coverage — which inputs were examined. */
  scanned: string[];
  /** What it cannot foresee (no evidence) — carried from perception's blind spots. */
  blindSpots: string[];
}

export interface ForecastInput {
  now: string;
  perception?: PerceptionReport | null;
  /** The orchestrator's plan — its deferrals are the accumulation signal (the F4 link). */
  plan?: FleetPlan | null;
  proposals?: ProposalQueueItem[];
  /** Pending-proposal age (hours) past which a stalled decision is projected. Default 72. */
  agingHours?: number;
  /**
   * Wolverine's immune-system report — its KNOWN findings are issues that don't heal on their
   * own, so Prophet projects each finding's consequence-of-inaction. Absent ⇒ not assessed
   * (carried as a blind spot). Backward compatible: omitting it leaves the forecast unchanged.
   */
  wolverine?: WolverineReport | null;
  /**
   * Executive Memory — the ONLY input that sees across time. A recurring pattern or a rising
   * problem-count trend is the genuinely forward-looking "this is becoming a standing condition"
   * signal a single snapshot can't produce. Absent ⇒ not assessed. Backward compatible.
   */
  memory?: ExecutiveMemoryReport | null;
  /**
   * Beezulbub capability-scout summaries — scouted-but-not-absorbed capabilities are latent gaps,
   * and scouts whose only top pick is risky/stale have no clean absorption path. Absent ⇒ not
   * assessed. Backward compatible: omitting it leaves the forecast unchanged.
   */
  capabilityScouts?: CapabilityScoutSummary[] | null;
}

const SEV_RANK: Record<ForecastSeverity, number> = { high: 3, medium: 2, low: 1 };

/**
 * The consequence-of-inaction for a Wolverine finding, BY CATEGORY (the entailment of leaving
 * that class of defect alone). Grounded in the finding's own evidence at the call site; this is
 * the projection ("if you do nothing, this is what continues"), never a fabricated prediction.
 */
function projectFinding(category: WolverineCategory, title: string): string {
  switch (category) {
    case "unsafe_flag":
      return `An execution flag is left enabled — the mutation floor stays open and an unintended write can fire at any time; it does not disarm itself.`;
    case "git_hygiene":
      return `Uncommitted or unpushed work stays one disk loss away from gone, and the longer it sits the harder the eventual merge.`;
    case "stale_data":
      return `Every decision reading this source stays wrong until it's refreshed — the error doesn't heal on its own.`;
    case "broken_wiring":
      return `The broken wiring keeps silently dropping work each run — the feature looks present but does nothing until it's repaired.`;
    case "missing_test":
      return `Untested behavior keeps regressing undetected — the next change can break it with nothing to catch it.`;
    case "doctrine_drift":
      return `The drift from doctrine widens with every further change — realigning later costs more than realigning now.`;
    case "proposal_bug":
      return `The proposal defect keeps mis-handling decisions on every run until it's fixed — bad outputs compound silently.`;
    case "failed_deploy":
      return `The failed/again-failing deploy means the live system stays behind intent until it lands — fixes you think shipped haven't.`;
    case "suspicious_confidence":
      return `A confidently-wrong answer keeps getting trusted as if solid — acting on it is the real risk, and it persists until corrected.`;
    case "duplicate_capability":
      return `Two agents claim the same job — work gets done twice or not at all, and ownership stays ambiguous until it's resolved.`;
    case "improvement":
      return `This improvement stays unrealized — not a defect, but the upside keeps not landing until it's picked up.`;
    default:
      return `"${title}" persists and compounds until the recommended fix is applied — it does not resolve on its own.`;
  }
}

/** A rising trend on a PROBLEM-count metric (more risks/drift/blind-spots) is bad; rising opportunities/confidence are not. */
function isRisingProblemTrend(t: MemoryTrend): boolean {
  const PROBLEM_METRICS = new Set(["risk_count", "drift_count", "blind_spot_count"]);
  return t.direction === "rising" && PROBLEM_METRICS.has(t.metric);
}

/**
 * Forecast the consequence of inaction. Deterministic: same input → same report.
 * Every consequence is backed by observed evidence (`basis`); nothing is invented.
 */
export function forecast(input: ForecastInput): ForecastReport {
  const consequences: Consequence[] = [];
  const scanned: string[] = [];
  const blindSpots: string[] = [];
  const nowMs = Date.parse(input.now);
  const agingHours = input.agingHours ?? 72;
  const agingDays = Math.round(agingHours / 24);

  let staleData = false;
  let deferredWork = false;

  // ── Perception → data-rot consequences (a present problem entails future wrongness) ──
  if (input.perception) {
    scanned.push("perception");
    for (const b of input.perception.blindSpots) if (!blindSpots.includes(b)) blindSpots.push(b);
    for (const o of input.perception.observations) {
      if (o.kind === "staleness" || o.kind === "drift") {
        staleData = true;
        consequences.push({
          subject: o.subject,
          projection: `Every decision that reads ${o.subject} stays wrong until it's refreshed — the error doesn't heal on its own.`,
          severity: o.severity === "critical" ? "high" : "medium",
          horizon: o.severity === "critical" ? "now" : "days",
          basis: o.detail,
          preventedBy: o.recommendation,
        });
      }
    }
  } else {
    blindSpots.push("perception (no report) — cannot forecast data-rot consequences");
  }

  // ── Orchestrator deferrals → accumulation consequences (the capstone F4 link) ──
  if (input.plan) {
    scanned.push("orchestration plan");
    const gap = input.plan.deferred.filter((d) => d.reason === "capability_gap");
    const cap = input.plan.deferred.filter((d) => d.reason === "capacity");
    if (gap.length) {
      deferredWork = true;
      const caps = [...new Set(gap.map((d) => d.task.targetCapability))].sort();
      consequences.push({
        subject: "fleet capability",
        projection: `${gap.length} task(s) needing ${caps.join(", ")} have no agent to do them — they accumulate with no path to completion.`,
        severity: "high",
        horizon: "week+",
        basis: `Orchestrator could not route ${gap.length} task(s): no agent has ${caps.join(", ")}.`,
        preventedBy: `Build an agent with the ${caps.join(", ")} capability.`,
      });
    }
    if (cap.length) {
      deferredWork = true;
      consequences.push({
        subject: "fleet capacity",
        projection: `${cap.length} task(s) exceed capacity each pass — the backlog grows until capacity rises or inflow slows.`,
        severity: "medium",
        horizon: "days",
        basis: `Orchestrator deferred ${cap.length} task(s) for capacity.`,
        preventedBy: "Raise the capable agents' capacity, or stagger the inflow.",
      });
    }
  }

  // ── Proposal queue → stalled-decision consequences ──
  const props = input.proposals ?? [];
  if (props.length) {
    scanned.push("proposal queue");
    const pending = props.filter((p) => p.status === "draft" || p.status === "pending_approval");
    const aging = pending.filter((p) => {
      const t = Date.parse(p.createdAt);
      return !Number.isNaN(t) && !Number.isNaN(nowMs) && (nowMs - t) / 3_600_000 > agingHours;
    });
    if (aging.length) {
      consequences.push({
        subject: "proposals",
        projection: `${aging.length} decision(s) have stalled >${agingDays}d; their basis keeps going stale, so approving them later gets riskier, not safer.`,
        severity: "medium",
        horizon: "days",
        basis: `${aging.length} pending proposal(s) older than ${agingDays}d.`,
        preventedBy: "Approve, reject, or expire the aging proposals.",
      });
    }
  }

  let knownDefects = false;
  let risingProblems = false;

  // ── Wolverine findings → consequence-of-inaction (a detected issue won't self-heal) ──
  if (input.wolverine) {
    scanned.push("wolverine");
    // Project the worst findings first; the immune system already ranked them.
    for (const fnd of input.wolverine.topRisks.slice(0, 4)) {
      knownDefects = true;
      consequences.push({
        subject: fnd.ownerAgent ? `${fnd.ownerAgent}: ${fnd.title}` : fnd.title,
        projection: projectFinding(fnd.category, fnd.title),
        severity: fnd.severity === "critical" || fnd.severity === "high" ? "high" : fnd.severity === "medium" ? "medium" : "low",
        horizon: fnd.severity === "critical" ? "now" : fnd.severity === "high" || fnd.severity === "medium" ? "days" : "week+",
        basis: fnd.evidence,
        preventedBy: fnd.recommendedFix,
      });
    }
  } else {
    blindSpots.push("wolverine (no report) — cannot forecast the consequence of known defects");
  }

  // ── Executive memory → trajectory consequences (the across-time signal) ──
  if (input.memory && input.memory.status === "ok") {
    scanned.push("executive memory");
    // A recurring risk/drift is a worsening standing condition, not a blip.
    for (const p of input.memory.recurringPatterns.filter((x) => x.kind === "risk" || x.kind === "drift").slice(0, 3)) {
      consequences.push({
        subject: `recurring: ${p.subject}`,
        projection: `"${p.subject}" has recurred ${p.occurrences}× — left unaddressed it hardens into a standing condition, not a one-off, and the cost of each recurrence keeps landing.`,
        severity: p.occurrences >= 4 ? "high" : "medium",
        horizon: "week+",
        basis: p.evidence,
        preventedBy: `Fix the root cause of "${p.subject}" — recurring means the symptom-level fix isn't holding.`,
      });
    }
    // A rising problem-count trend = accumulating faster than clearing.
    for (const t of input.memory.trends.filter(isRisingProblemTrend)) {
      risingProblems = true;
      consequences.push({
        subject: `trend: ${t.metric}`,
        projection: `${t.metric} is rising (${t.from} → ${t.to}) — the system is accumulating problems faster than it's clearing them; the trajectory is the warning, not any single item.`,
        severity: "medium",
        horizon: "days",
        basis: t.evidence,
        preventedBy: "Clear faster than inflow — triage the leading source driving the rise before adding new work.",
      });
    }
  }

  // ── Beezulbub capability scouts → latent-gap + no-clean-path consequences ──
  if (input.capabilityScouts && input.capabilityScouts.length) {
    scanned.push("capability scouts");
    const withCandidates = input.capabilityScouts.filter((s) => s.candidateCount > 0);
    const noCleanPath = withCandidates.filter((s) => s.riskyTopLicense || s.staleTop);
    if (withCandidates.length) {
      consequences.push({
        subject: "capability absorption",
        projection: `${withCandidates.length} capability(ies) have been scouted but not absorbed — the gaps they'd close stay open, and the scout data ages until someone re-scouts and repeats the work.`,
        severity: "medium",
        horizon: "week+",
        basis: `Beezulbub scouted ${withCandidates.length} capability target(s) with candidates on file; none absorbed yet.`,
        preventedBy: "Pick a scout to act on: digest the top candidate, then approve/reject absorption — or close it out if no longer needed.",
      });
    }
    if (noCleanPath.length) {
      consequences.push({
        subject: "absorption risk",
        projection: `${noCleanPath.length} scouted capability(ies) lead with a copyleft/unknown-license or stale top pick — there is no clean absorption path, so absorbing blindly drifts license posture or pulls in unmaintained code.`,
        severity: "medium",
        horizon: "days",
        basis: `Top candidates flagged risky-license/stale: ${noCleanPath.map((s) => s.target).slice(0, 4).join(", ")}.`,
        preventedBy: "Re-scout for a permissive, maintained alternative, or treat the risky pick as reference-only.",
      });
    }
  }

  // ── Compounding: stale inputs AND uncleared work reinforce each other ──
  if (staleData && deferredWork) {
    consequences.push({
      subject: "system",
      projection: "Stale inputs and uncleared work compound: you'll be acting on old data with a backlog that's still growing.",
      severity: "high",
      horizon: "days",
      basis: "Both data staleness and deferred fleet work are present at once.",
      preventedBy: "Clear the wave-1 refresh/repair first, then expand capacity for the rest.",
    });
  }

  // ── Compounding: a RED immune system WHILE problems are trending up = a worsening crisis ──
  if (knownDefects && risingProblems && input.wolverine?.verdict === "RED") {
    consequences.push({
      subject: "system",
      projection: "The immune system is RED and the problem count is rising at the same time — known defects are landing while the system falls further behind on clearing them.",
      severity: "high",
      horizon: "now",
      basis: "Wolverine verdict RED and a rising problem-count trend coincide.",
      preventedBy: "Stop new intake; clear the top Wolverine repairs first, then re-measure the trend.",
    });
  }

  consequences.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
  const verdict: ForecastVerdict = consequences.some((c) => c.severity === "high" && (c.horizon === "now" || c.horizon === "days"))
    ? "urgent"
    : consequences.length
      ? "degrading"
      : "stable";

  return { verdict, consequences, scanned, blindSpots };
}

/** One-line, deterministic summary of a forecast (for embedding / the cockpit). */
export function summarizeForecast(r: ForecastReport): string {
  const body = r.consequences.length ? `${r.consequences.length} consequence(s) of inaction` : "no projected consequences";
  const blind = r.blindSpots.length ? ` · ${r.blindSpots.length} blind spot(s)` : "";
  return `Forecast ${r.verdict.toUpperCase()} — ${body}${blind}.`;
}
