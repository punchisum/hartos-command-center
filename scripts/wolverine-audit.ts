/**
 * scripts/wolverine-audit.ts — Wolverine v1 audit CLI (the host edge).
 *
 * Gathers the read-only inputs (env flags + git facts) and runs the pure `wolverineAudit`,
 * printing the GREEN/AMBER/RED verdict, the top risks, and the ranked repair queue. Read-only:
 * it inspects and reports — it NEVER mutates, deploys, or repairs. Doctrine: automatic eyes,
 * gated hands.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/wolverine-audit.js
 */

import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { wolverineAudit } from "../src/wolverine/wolverine-audit.js";
import { resolveHostedCockpitState } from "../src/runtime/cloudflare-live-read-models.js";
import type { GitFacts, WolverineFinding, WolverineReport } from "../src/wolverine/wolverine-types.js";

function gatherGitFacts(cwd: string): GitFacts | undefined {
  const git = (args: string): string | null => {
    try {
      return execSync(`git ${args}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  };
  const branch = git("rev-parse --abbrev-ref HEAD");
  if (branch === null) return undefined; // not a git repo / git unavailable
  const porcelain = git("status --porcelain");
  const lines = porcelain ? porcelain.split(/\r?\n/).filter(Boolean) : [];
  const untracked = lines.filter((l) => l.startsWith("??")).length;
  const uncommitted = lines.length - untracked;
  let ahead: number | null = null;
  let hasUpstream = false;
  const a = git("rev-list --count @{u}..HEAD");
  if (a !== null && /^\d+$/.test(a)) {
    ahead = Number(a);
    hasUpstream = true;
  }
  return { branch, uncommitted, untracked, ahead, hasUpstream };
}

const SEV_TAG: Record<WolverineFinding["severity"], string> = {
  critical: "[CRIT]",
  high: "[HIGH]",
  medium: "[MED ]",
  low: "[LOW ]",
};

export function renderReport(report: WolverineReport): string[] {
  const out: string[] = [];
  out.push(`\nWolverine — system audit (read-only; repairs are approval-gated)`);
  out.push(`  Verdict: ${report.verdict} — ${report.verdictReason}`);
  const b = report.bySeverity;
  out.push(`  Findings: ${report.findingCount}  (crit ${b.critical} · high ${b.high} · med ${b.medium} · low ${b.low})`);
  if (report.repairQueue.length === 0) {
    out.push("  Nothing surfaced by the active detectors (coverage is partial in v1).");
    return out;
  }
  out.push(`\n  Repair queue (worst first):`);
  for (const f of report.repairQueue) {
    out.push(`  ${SEV_TAG[f.severity]} ${f.title}`);
    out.push(`         why:  ${f.evidence}`);
    out.push(`         fix:  ${f.recommendedFix}`);
    out.push(`         undo: ${f.rollbackPath}  ·  approval: ${f.approvalRequired ? "required" : "no"}  ·  ${f.confidence} confidence`);
  }
  out.push(`\n  ${report.note}`);
  return out;
}

const invokedDirectly =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void (async () => {
    const cwd = process.cwd();
    const now = new Date().toISOString();
    // Reuse the cockpit's OWN freshness assessment (sourceDiagnostics.staleSources) for the
    // stale-read-model detector. Read-only; null/empty when no read-model env is configured.
    const state = await resolveHostedCockpitState(process.env, { now }).catch(() => null);
    const staleSources = state?.sourceDiagnostics?.staleSources ?? [];
    const report = wolverineAudit({ now, env: process.env, git: gatherGitFacts(cwd), staleSources });
    for (const line of renderReport(report)) console.log(line);
    console.log("");
  })();
}
