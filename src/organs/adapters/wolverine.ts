/**
 * src/organs/adapters/wolverine.ts — the Wolverine organ adapter.
 *
 * Wolverine is the HartOS immune system: ADVISORY ONLY — it inspects, scores, and PROPOSES;
 * it NEVER executes a fix. This adapter runs the pure `wolverineAudit` DIRECTLY under the
 * supervisor (the audit's correct home — the old agent_job path caused a runaway loop and is
 * gone). It assembles only the read-only inputs it can safely gather here: the injected ISO
 * `now`, the process env (config flags, not secrets), and git facts via read-only git commands.
 *
 * Doctrine: status is DERIVED from evidence; we NEVER fabricate ok:true. ok=true means the audit
 * actually produced a report (the pure aggregator is internally crash-proof — each detector is
 * isolated). Coverage is honest-PARTIAL: the heavier inputs (Supabase read-models, vault scan,
 * Sentinel liveness) involve network/FS side-effects and are deliberately NOT assembled here to
 * keep the adapter thin — those domains report "not assessed", they are never faked.
 */
import { execSync } from "node:child_process";
import type { OrganAdapter } from "../organ-supervisor.js";
import type { OrganRunResult } from "../organ-contract.js";
import { wolverineAudit } from "../../wolverine/wolverine-audit.js";
import type { GitFacts } from "../../wolverine/wolverine-types.js";

/** Trim the honest summary to the contract's <300-char budget. */
function cap(s: string): string {
  return s.length > 299 ? s.slice(0, 299) : s;
}

/**
 * Gather read-only git facts (branch / uncommitted / untracked / ahead). Pure inspection —
 * `status`/`rev-parse`/`rev-list` mutate nothing. Returns undefined when not a git repo / git
 * unavailable, so the git-hygiene detector honestly reports "not assessed".
 */
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

export const wolverineOrgan: OrganAdapter = {
  organId: "wolverine",
  armingFlag: "HARTOS_ALLOW_WOLVERINE_AUDIT",
  async run(env: NodeJS.ProcessEnv, now: string): Promise<OrganRunResult> {
    try {
      const report = wolverineAudit({
        now,
        env: env as Record<string, string | undefined>,
        git: gatherGitFacts(process.cwd()),
      });
      // ADVISORY ONLY: we surface the verdict + worst finding(s); we never apply a fix.
      const top = report.topRisks[0];
      const headline =
        report.findingCount === 0
          ? report.verdictReason
          : `${top.title}${report.topRisks[1] ? ` · ${report.topRisks[1].title}` : ""}`;
      return {
        ok: true,
        outputRef: `audit:${report.findingCount} findings`,
        summary: cap(`${report.verdict} — ${headline}`),
        detail: {
          verdict: report.verdict,
          verdictReason: report.verdictReason,
          findingCount: report.findingCount,
          bySeverity: report.bySeverity,
          topRisks: report.topRisks.map((f) => ({ id: f.id, severity: f.severity, title: f.title })),
          advisoryOnly: true,
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, outputRef: null, summary: cap(`wolverine audit failed: ${msg}`) };
    }
  },
};
