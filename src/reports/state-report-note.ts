/**
 * src/reports/state-report-note.ts — PURE builder for a HartOS State Report note.
 *
 * A "report" is a deterministic, human-readable SNAPSHOT of HartOS's live state: system health
 * (Wolverine), outlook (Prophet), the Chief-of-Staff decision headline, memory, and — for honesty —
 * the autonomy posture (exactly which gates are armed right now). No fabrication: an empty section
 * means no signal, never an invented one. This module is the pure contract; gathering + filing live
 * in scripts/report-run.ts. No fs/clock/net (now injected).
 */

import type { ObsidianNoteProposal } from "../obsidian/obsidian-types.js";

export interface StateReportRisk {
  severity: string;
  title: string;
  recommendedFix?: string;
}

export interface StateReportConsequence {
  subject: string;
  severity: string;
  projection: string;
}

export interface StateReportSections {
  /** The job arg / scope (free text); "" → a general state report. */
  focus: string;
  verdict: string;
  verdictReason: string;
  findingCount: number;
  topRisks: StateReportRisk[];
  forecastSummary: string;
  consequences: StateReportConsequence[];
  decisionsHeadline: string | null;
  /** A one-line memory summary (summarizeMemory) or an honest "insufficient history". */
  memorySummary: string;
  recurringSubjects: string[];
  /** What is armed right now — so the report tells the truth about HartOS's current autonomy. */
  postureLines: string[];
}

/** Filesystem-safe slug for the report artifact filename. */
export function reportSlug(focus: string, now: string): string {
  const base =
    (focus || "hartos-state").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) ||
    "hartos-state";
  return `${base}-${now.slice(0, 10)}`;
}

export function buildStateReportNote(s: StateReportSections, now: string): ObsidianNoteProposal {
  const day = now.slice(0, 10);
  const title = s.focus ? `HartOS Report — ${s.focus}` : `HartOS State Report — ${day}`;
  const focusTag = s.focus.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

  const body = [
    `# ${title}`,
    "",
    `_Generated ${now} — a deterministic synthesis of HartOS's live state. No fabrication: an empty section means no signal._`,
    "",
    "## Executive summary",
    s.decisionsHeadline ?? "_No decision synthesis available this run._",
    "",
    "## System health (Wolverine)",
    `**Verdict: ${s.verdict}** — ${s.verdictReason}  ·  ${s.findingCount} finding(s)`,
    "",
    ...(s.topRisks.length
      ? s.topRisks.map((r) => `- **[${r.severity}] ${r.title}**${r.recommendedFix ? `\n    - fix: ${r.recommendedFix}` : ""}`)
      : ["- _No risks surfaced by the active detectors._"]),
    "",
    "## Outlook (Prophet)",
    s.forecastSummary,
    "",
    ...(s.consequences.length
      ? s.consequences.map((c) => `- **${c.subject}** [${c.severity}]: ${c.projection}`)
      : ["- _No projected consequences._"]),
    "",
    "## Memory",
    s.memorySummary,
    ...(s.recurringSubjects.length ? ["", `Recurring subjects: ${s.recurringSubjects.join(", ")}`] : []),
    "",
    "## Autonomy posture (what is armed right now)",
    ...(s.postureLines.length ? s.postureLines.map((l) => `- ${l}`) : ["- _Nothing armed — fully propose-only._"]),
    "",
    "_Filed by the HartOS report runner. A snapshot, not a live feed; re-run for a fresh one._",
  ].join("\n");

  return {
    title,
    folder: "HartOS/Reports",
    noteType: "executive_weekly_review",
    tags: ["hartos", "report", s.verdict.toLowerCase(), focusTag].filter(Boolean),
    body,
    sources: ["wolverine:audit", "prophet:forecast", "cockpit:decision-synthesis"],
    confidence: "high",
    reason:
      "On-demand HartOS state report — a human-readable snapshot of health, outlook, decisions, and " +
      "autonomy posture, kept in the vault for review.",
    reviewBy: null,
    relatedAgents: ["Wolverine", "Prophet", "Orchestrator"],
    relatedProposals: [],
    createdAt: now,
  };
}
