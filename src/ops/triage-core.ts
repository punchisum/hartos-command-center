/**
 * src/ops/triage-core.ts
 *
 * Depth upgrade for the Ops digest — a deterministic TRIAGE core, replacing the
 * panel's 5-branch first-match count cascade (which surfaced ONE action and hardcoded
 * confidence "low"). Instead this builds the WHOLE picture: every operational front
 * that needs attention, ranked by IMPACT (blocked/urgent/risk halt or threaten work →
 * high; waiting/approvals/adrift cards need a decision → medium; stale just needs a
 * review → low), then by a category priority (blocked before urgent even when urgent's
 * count is higher — stuck work is worse than busy work), then by count.
 *
 * It is honest about the data it stands on: when the ClickUp import is stale it says
 * so (the counts may not reflect the board) and caps its own confidence; with no card
 * counts at all it returns insufficient_data rather than a fabricated "all clear".
 * Pure + deterministic: same signals → same triage. An LLM may narrate it later.
 */

import type { SourceResult } from "../cockpit/sources/source-types.js";

export type OpsTriageVerdict = "clear" | "monitor" | "act" | "urgent" | "insufficient_data";
export type OpsTriageConfidence = "high" | "medium" | "low";
export type TriageCategory = "blocked" | "urgent" | "risk" | "waiting" | "approvals" | "no_next_action" | "stale";
export type TriageSeverity = "high" | "medium" | "low";

export interface OpsSignals {
  urgent?: number;
  blocked?: number;
  stale?: number;
  waiting?: number;
  noNextAction?: number;
  activeCards?: number;
  pendingApprovals?: number;
  /** Raw risk-flag text, if the read-model surfaced any. */
  riskFlags?: string;
  /** The ClickUp import is stale → counts are computed on old data. */
  syncStale?: boolean;
}

export interface TriageItem {
  category: TriageCategory;
  /** Card count for the front (0 for the qualitative risk front). */
  count: number;
  severity: TriageSeverity;
  action: string;
}

export interface OpsTriage {
  verdict: OpsTriageVerdict;
  /** Priority-ranked fronts (impact, then category priority, then count) — the whole picture. */
  queue: TriageItem[];
  /** Single highest-priority next action. */
  primaryAction: string;
  /** Total cards needing attention across the actionable fronts. */
  totalActionable: number;
  /** Honest caveats (e.g. a stale import makes the counts suspect). */
  caveats: string[];
  confidence: OpsTriageConfidence;
  reason: string;
  /** Operator framing: what this situation actually means for the business / flow of work. */
  impact: string;
  /** Named operational risks (stalled work, missing follow-ups, import failure) — not generic. */
  risks: string[];
  /** The cheapest high-leverage win available right now — null when there's nothing cheap to clear. */
  opportunity: string | null;
}

const SEV_RANK: Record<TriageSeverity, number> = { high: 3, medium: 2, low: 1 };

interface CatSpec { category: Exclude<TriageCategory, "risk">; severity: TriageSeverity; action: (n: number) => string; }
const CATS: CatSpec[] = [
  { category: "blocked", severity: "high", action: (n) => `Triage ${n} blocked/at-risk card(s) first.` },
  { category: "urgent", severity: "high", action: (n) => `Action ${n} urgent card(s).` },
  { category: "waiting", severity: "medium", action: (n) => `Unblock ${n} card(s) waiting on Hart.` },
  { category: "approvals", severity: "medium", action: (n) => `Clear ${n} pending approval(s).` },
  { category: "no_next_action", severity: "medium", action: (n) => `Assign a next action to ${n} adrift card(s).` },
  { category: "stale", severity: "low", action: (n) => `Review ${n} stale card(s) with no recent activity.` },
];

// Intra-severity ordering: stuck work (blocked) outranks busy work (urgent) even when
// urgent's count is higher; risk flags sit just below the concrete high-impact fronts.
const PRIORITY: Record<TriageCategory, number> = {
  blocked: 100, urgent: 90, risk: 80, waiting: 70, approvals: 60, no_next_action: 50, stale: 40,
};

function countFor(s: OpsSignals, cat: CatSpec["category"]): number {
  switch (cat) {
    case "blocked": return s.blocked ?? 0;
    case "urgent": return s.urgent ?? 0;
    case "waiting": return s.waiting ?? 0;
    case "approvals": return s.pendingApprovals ?? 0;
    case "no_next_action": return s.noNextAction ?? 0;
    case "stale": return s.stale ?? 0;
  }
}

/** Triage the ops signals into a ranked queue. Deterministic; never fabricates an all-clear. */
export function triageOps(signals: OpsSignals): OpsTriage {
  const queue: TriageItem[] = [];
  for (const spec of CATS) {
    const n = countFor(signals, spec.category);
    if (n > 0) queue.push({ category: spec.category, count: n, severity: spec.severity, action: spec.action(n) });
  }
  const risk = signals.riskFlags?.trim();
  const hasRisk = !!risk && !/^(none|no risks?|n\/a)$/i.test(risk);
  if (hasRisk) queue.push({ category: "risk", count: 0, severity: "high", action: `Address operational risk flags: ${risk}.` });

  queue.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || PRIORITY[b.category] - PRIORITY[a.category] || b.count - a.count);
  const totalActionable = queue.reduce((sum, i) => sum + i.count, 0);

  const caveats: string[] = [];
  if (signals.syncStale) caveats.push("ClickUp import is stale — these counts may not reflect the current board.");

  const countVals = [signals.urgent, signals.blocked, signals.stale, signals.waiting, signals.noNextAction, signals.activeCards, signals.pendingApprovals];
  const hasCounts = countVals.some((v) => typeof v === "number");

  let verdict: OpsTriageVerdict;
  let primaryAction: string;
  if (!hasCounts && !hasRisk) {
    verdict = "insufficient_data";
    primaryAction = "Surface ops card counts (urgent/blocked/stale) before HartOS can triage.";
  } else if (queue.length === 0) {
    verdict = "clear";
    primaryAction = "No urgent/blocked signal — review the latest sync + reports to confirm.";
  } else {
    primaryAction = queue[0]!.action;
    verdict = queue[0]!.severity === "high" ? "urgent" : queue[0]!.severity === "medium" ? "act" : "monitor";
  }

  // Confidence: no counts → low; a stale import makes counts suspect → cap at medium;
  // otherwise rise with how many distinct counts we actually have.
  let confidence: OpsTriageConfidence;
  if (!hasCounts) confidence = "low";
  else if (signals.syncStale) confidence = "medium";
  else {
    const breadth = countVals.filter((v) => typeof v === "number").length;
    confidence = breadth >= 3 ? "high" : "medium";
  }

  const reason = verdict === "insufficient_data"
    ? "No card counts or risk flags available to triage."
    : verdict === "clear"
      ? "No actionable fronts in the available counts."
      : `${queue.length} front(s) need attention; leading with ${queue[0]!.category} (${queue[0]!.severity}).`;

  const impact = impactOf(signals, queue, verdict);
  const risks = risksOf(signals);
  const opportunity = opportunityOf(signals);

  return { verdict, queue, primaryAction, totalActionable, caveats, confidence, reason, impact, risks, opportunity };
}

/** Operator framing: what the situation means for the flow of work, not just the counts. */
function impactOf(s: OpsSignals, queue: TriageItem[], verdict: OpsTriageVerdict): string {
  if (verdict === "insufficient_data") return "Can't assess impact — the board isn't surfaced.";
  if (verdict === "clear") return "No work is currently halted or threatened — capacity is free for proactive moves.";
  const blocked = s.blocked ?? 0;
  const urgent = s.urgent ?? 0;
  const parts: string[] = [];
  if (blocked > 0) parts.push(`${blocked} ${plural(blocked, "thread")} of work ${plural(blocked, "is", "are")} fully halted (blocked)`);
  if (urgent > 0) parts.push(`${urgent} ${plural(urgent, "item")} ${plural(urgent, "is", "are")} time-critical`);
  if (parts.length === 0) {
    const waiting = s.waiting ?? 0;
    const adrift = s.noNextAction ?? 0;
    if (waiting > 0) parts.push(`${waiting} ${plural(waiting, "decision")} ${plural(waiting, "is", "are")} parked on you`);
    if (adrift > 0) parts.push(`${adrift} ${plural(adrift, "card")} ${plural(adrift, "has", "have")} no next step and will drift`);
  }
  return parts.length
    ? `${cap(parts.join("; "))} — every day these sit, downstream work and trust erode.`
    : "Work is moving, but a few fronts need a light touch to stay on track.";
}

/** Named operational risks — stalled work, missing follow-ups, import failure. Not generic. */
function risksOf(s: OpsSignals): string[] {
  const out: string[] = [];
  const blocked = s.blocked ?? 0;
  const stale = s.stale ?? 0;
  const adrift = s.noNextAction ?? 0;
  if (blocked > 0 && stale > 0) {
    out.push(`Stall risk: ${blocked} blocked AND ${stale} stale — work that's both stuck and untouched tends to become a dead project no one owns.`);
  } else if (blocked > 0) {
    out.push(`${blocked} blocked ${plural(blocked, "card")} — confirm each is genuinely waiting on an external dependency, not quietly abandoned.`);
  }
  if (adrift > 0) {
    out.push(`${adrift} ${plural(adrift, "card")} with no next action — these are where follow-ups silently go missing.`);
  }
  if (s.syncStale) {
    out.push("ClickUp import is stale — the board you're triaging may already be wrong; treat counts as a lower bound.");
  }
  return out;
}

/** The cheapest high-leverage win available now — clearing decisions/approvals unblocks others' work. */
function opportunityOf(s: OpsSignals): string | null {
  const waiting = s.waiting ?? 0;
  const approvals = s.pendingApprovals ?? 0;
  const adrift = s.noNextAction ?? 0;
  if (waiting > 0 || approvals > 0) {
    const n = waiting + approvals;
    return `${n} ${plural(n, "item")} ${plural(n, "is", "are")} parked on a single decision/approval from you — clearing them is minutes of work that unblocks flow elsewhere. Quick win.`;
  }
  if (adrift > 0) {
    return `${adrift} adrift ${plural(adrift, "card")} just ${plural(adrift, "needs", "need")} a next action assigned — cheap to fix, and it stops them rotting into stale.`;
  }
  return null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

function cap(str: string): string {
  return str ? `${str[0]!.toUpperCase()}${str.slice(1)}` : str;
}

/** One-line, deterministic summary of an ops triage (for embedding / the panel). */
export function summarizeTriage(t: OpsTriage): string {
  return `Ops triage ${t.verdict.toUpperCase()} — ${t.queue.length} front(s), ${t.totalActionable} card(s) actionable.`;
}

function num(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const m = raw.match(/-?\d+(\.\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Adapt a resolved Ops SourceResult into triage signals. Pure: only parses already-
 * resolved values, and reads sync staleness from the source freshness so a stale
 * ClickUp import is honestly reflected (suspect counts + capped confidence).
 */
export function opsSignalsFromSource(src: SourceResult): OpsSignals {
  const urgent = num(src.values["urgent"]?.value);
  const blocked = num(src.values["blocked"]?.value);
  const stale = num(src.values["stale"]?.value);
  const waiting = num(src.values["waiting"]?.value);
  const noNextAction = num(src.values["no_next_action"]?.value);
  const activeCards = num(src.values["active_cards"]?.value);
  const pendingApprovals = num(src.values["pending_approvals"]?.value);
  const riskFlags = src.values["risk_flags"]?.value;
  return {
    ...(urgent != null ? { urgent } : {}),
    ...(blocked != null ? { blocked } : {}),
    ...(stale != null ? { stale } : {}),
    ...(waiting != null ? { waiting } : {}),
    ...(noNextAction != null ? { noNextAction } : {}),
    ...(activeCards != null ? { activeCards } : {}),
    ...(pendingApprovals != null ? { pendingApprovals } : {}),
    ...(riskFlags ? { riskFlags } : {}),
    syncStale: src.freshness === "stale",
  };
}
