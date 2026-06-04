/**
 * src/hartos/orchestrator-report.ts
 *
 * Formats and writes Orchestrator / strategy / CTO / build-plan / handover
 * reports. All reports are deterministic and secret-safe.
 *
 * NEVER include raw secrets in any output.
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  ClassifiedRequest,
  StrategyReviewResult,
  CtoReviewResult,
  CapabilityGapResult,
  BuildPlanResult,
  OrchestratorResult,
  HandoverResult,
  OrchestratorReportSidecar,
} from "./orchestrator-types.js";

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{20,}/,
];

export function assertNoSecretsInReport(content: string): void {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      throw new Error("Secret-looking value in HartOS report. Report generation aborted.");
    }
  }
}

function bullets(items: string[], emptyText = "none"): string[] {
  if (items.length === 0) return [`- ${emptyText}`];
  return items.map((i) => `- ${i}`);
}

// ─── Classification ───────────────────────────────────────────────────────────

export function formatClassification(c: ClassifiedRequest): string[] {
  return [
    `## Classification`,
    ``,
    `- Classification: **${c.classification}**`,
    `- Domain: ${c.domain}`,
    `- Risk level: ${c.riskLevel}`,
    `- Build target: ${c.buildTarget}`,
    `- Recommended specialist: ${c.recommendedSpecialist}`,
    `- Needs strategy review: ${c.needsStrategyReview ? "yes" : "no"}`,
    `- Needs CTO review: ${c.needsCtoReview ? "yes" : "no"}`,
    ``,
    `Rationale:`,
    ...bullets(c.rationale),
  ];
}

// ─── Strategy ─────────────────────────────────────────────────────────────────

export function formatStrategy(s: StrategyReviewResult): string[] {
  return [
    `## Strategy Review (Prophet)`,
    ``,
    `- Verdict: **${s.verdict}**`,
    `- Expected leverage: ${s.expectedLeverage}`,
    `- Risk: ${s.risk}`,
    `- Maintenance burden: ${s.maintenanceBurden}`,
    ``,
    `Reason: ${s.reason}`,
    ``,
    s.simplerAlternative ? `Simpler alternative: ${s.simplerAlternative}` : `Simpler alternative: none identified`,
    ``,
    `Required proof:`,
    ...bullets(s.requiredProof),
    ``,
    `Recommended next action: ${s.recommendedNextAction}`,
    ``,
    `Scores (0–10):`,
    ...Object.entries(s.scores).map(([k, v]) => `- ${k}: ${v}`),
  ];
}

// ─── CTO ──────────────────────────────────────────────────────────────────────

export function formatCto(c: CtoReviewResult): string[] {
  return [
    `## CTO Technical Review`,
    ``,
    `- Technical verdict: **${c.technicalVerdict}**`,
    ``,
    `Existing (usable) capabilities:`,
    ...bullets(c.existingCapabilities),
    ``,
    `Planning-only capabilities (NOT production):`,
    ...bullets(c.planningOnlyCapabilities),
    ``,
    `Missing capabilities:`,
    ...bullets(c.missingCapabilities),
    ``,
    `Recommended Beezulbub actions:`,
    ...bullets(c.recommendedBeezulbubActions),
    ``,
    `Recommended Factory actions:`,
    ...bullets(c.recommendedFactoryActions),
    ``,
    `Dependencies:`,
    ...bullets(c.dependencies),
    ``,
    `Risks:`,
    ...bullets(c.risks),
    ``,
    `Implementation sequence:`,
    ...c.implementationSequence.map((s, i) => `${i + 1}. ${s}`),
    ``,
    `Human approvals required:`,
    ...bullets(c.humanApprovalsRequired),
  ];
}

// ─── Capability gap ───────────────────────────────────────────────────────────

export function formatGap(g: CapabilityGapResult): string[] {
  const lines = [
    `## Capability Gap`,
    ``,
    `Build target: ${g.buildTarget}`,
    `Required capabilities: ${g.requiredCapabilities.join(", ") || "none"}`,
    ``,
  ];
  for (const item of g.items) {
    lines.push(`### ${item.capabilityId}`);
    lines.push(`- Registry status: ${item.registryStatus}`);
    lines.push(`- Usability: ${item.usability}`);
    lines.push(`- Provenance: ${item.hasProvenance ? "yes" : "no"}`);
    lines.push(`- ${item.recommendation}`);
    if (item.recommendedBeezulbubAction) {
      lines.push(`- Action: ${item.recommendedBeezulbubAction}`);
    }
    lines.push(``);
  }
  if (g.items.length === 0) lines.push("No specific capabilities required (generic request).", "");
  return lines;
}

// ─── Build plan ───────────────────────────────────────────────────────────────

export function formatBuildPlan(b: BuildPlanResult): string {
  const lines = [
    `# HartOS Build Plan`,
    ``,
    `Request: ${b.request}`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    ...formatClassification(b.classification),
    ``,
  ];
  if (b.strategy) lines.push(...formatStrategy(b.strategy), ``);
  if (b.cto) lines.push(...formatCto(b.cto), ``);
  lines.push(...formatGap(b.gap), ``);

  lines.push(`## Domain placement`, ``, b.domainPlacement, ``);

  lines.push(`## Build sequence`, ``);
  for (const phase of b.phaseBreakdown) {
    lines.push(`${phase.order}. **${phase.title}** — ${phase.description}`);
  }
  lines.push(``);

  lines.push(`## Recommended Beezulbub actions`, ``, ...bullets(b.recommendedBeezulbubActions), ``);
  lines.push(`## Recommended Factory actions`, ``, ...bullets(b.recommendedFactoryActions), ``);
  lines.push(`## Approval gates`, ``, ...bullets(b.approvalGates), ``);
  lines.push(`## Risks`, ``, ...bullets(b.risks), ``);
  lines.push(`## Do NOT build`, ``, ...bullets(b.doNotBuild), ``);
  lines.push(b.nextPromptSkeleton, ``);

  lines.push(`---`, `Generated by HartOS Orchestrator Phase 11F (local, deterministic, no mutation).`);
  return lines.join("\n") + "\n";
}

// ─── Strategy / CTO standalone reports ────────────────────────────────────────

export function formatStrategyReport(s: StrategyReviewResult): string {
  const lines = [
    `# HartOS Strategy Review`,
    ``,
    `Request: ${s.request}`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    ...formatStrategy(s),
    ``,
    `---`,
    `Generated by HartOS Strategy Review (Prophet) Phase 11F.`,
  ];
  return lines.join("\n") + "\n";
}

export function formatCtoReport(c: CtoReviewResult): string {
  const lines = [
    `# HartOS CTO Review`,
    ``,
    `Request: ${c.request}`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    ...formatCto(c),
    ``,
    `---`,
    `Generated by HartOS CTO Review Phase 11F.`,
  ];
  return lines.join("\n") + "\n";
}

// ─── Orchestrator report ──────────────────────────────────────────────────────

export function formatOrchestratorReport(r: OrchestratorResult): string {
  const lines = [
    `# HartOS Orchestrator Report`,
    ``,
    `Request: ${r.request}`,
    `Generated: ${r.generatedAt}`,
    ``,
    ...formatClassification(r.classification),
    ``,
  ];
  if (r.strategy) lines.push(...formatStrategy(r.strategy), ``);
  else lines.push(`## Strategy Review (Prophet)`, ``, `Not required for this request.`, ``);

  if (r.cto) lines.push(...formatCto(r.cto), ``);
  else lines.push(`## CTO Technical Review`, ``, `Not required for this request.`, ``);

  if (r.gap) lines.push(...formatGap(r.gap), ``);

  if (r.buildPlan) {
    lines.push(`## Build Plan Summary`, ``);
    for (const phase of r.buildPlan.phaseBreakdown) {
      lines.push(`${phase.order}. **${phase.title}** — ${phase.description}`);
    }
    lines.push(``);
    lines.push(`Do NOT build:`);
    lines.push(...bullets(r.buildPlan.doNotBuild));
    lines.push(``);
  }

  lines.push(`---`, `Generated by HartOS Orchestrator Phase 11F (local, deterministic, no mutation).`);
  return lines.join("\n") + "\n";
}

// ─── Handover report ──────────────────────────────────────────────────────────

export function formatHandoverReport(h: HandoverResult): string {
  const lines = [
    `# HartOS Handover`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    h.sourceReport ? `Source: ${h.sourceReport}` : `Source: (no prior orchestrator report found)`,
    ``,
    `## Current request`,
    ``,
    h.request ?? "(none — run hartos:orchestrate first)",
    ``,
    `## Status`,
    ``,
    `- Classification: ${h.classification ?? "n/a"}`,
    `- Strategy verdict: ${h.strategyVerdict ?? "n/a"}`,
    `- CTO verdict: ${h.ctoVerdict ?? "n/a"}`,
    ``,
    `## Capability status`,
    ``,
    ...bullets(h.capabilityStatus),
    ``,
    `## Recommended next action`,
    ``,
    h.recommendedNextAction,
    ``,
    `## Commands to run next`,
    ``,
    ...bullets(h.commandsToRunNext),
    ``,
    `## Risks`,
    ``,
    ...bullets(h.risks),
    ``,
    `## Open questions`,
    ``,
    ...bullets(h.openQuestions),
    ``,
    `---`,
    `Generated by HartOS Handover Phase 11F. Paste into ChatGPT / Claude / Codex.`,
  ];
  return lines.join("\n") + "\n";
}

// ─── Report writers ───────────────────────────────────────────────────────────

export type ReportKind =
  | "orchestrator"
  | "strategy-review"
  | "cto-review"
  | "build-plan"
  | "handover";

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function writeReport(
  reportsDir: string,
  kind: ReportKind,
  content: string
): Promise<string> {
  assertNoSecretsInReport(content);
  await mkdir(reportsDir, { recursive: true });
  const filePath = path.join(reportsDir, `${kind}-${timestamp()}.md`);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

/** Write a safe JSON sidecar (no secrets) used by hartos:handover. */
export async function writeSidecar(
  reportsDir: string,
  sidecar: OrchestratorReportSidecar
): Promise<string> {
  const content = JSON.stringify(sidecar, null, 2) + "\n";
  assertNoSecretsInReport(content);
  await mkdir(reportsDir, { recursive: true });
  const filePath = path.join(reportsDir, `orchestrator-${timestamp()}.json`);
  await writeFile(filePath, content, "utf8");
  return filePath;
}
