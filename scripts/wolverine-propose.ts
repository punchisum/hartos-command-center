/**
 * scripts/wolverine-propose.ts — Wolverine: turn audit findings into gated FixProposals.
 *
 * The host edge of the repair loop. It gathers the proposal-spine stats (read-only), runs the
 * pure audit, maps fixable findings → tier-complete FixProposals, and STAGES them in the local
 * queue at `simulated_approved` (Wolverine has run the deterministic detection — the "simulation"
 * — so the proposal is ready for HART's execution approval). It NEVER executes: the mutation only
 * happens when Hart approves (agent:approve-execution) and fires execute:approved. Automatic eyes,
 * gated hands.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/wolverine-propose.js
 */

import { pathToFileURL } from "node:url";
import { wolverineAudit } from "../src/wolverine/wolverine-audit.js";
import { wolverineFixProposals } from "../src/wolverine/wolverine-fix-proposal.js";
import { saveProposal, markSimulatedApproved } from "../src/cockpit/proposals/proposal-queue.js";
import { resolveCockpitProposals } from "../src/runtime/cloudflare-live-read-models.js";
import { ADAPTER_ROUTE_KEY } from "../src/cockpit/suggestions/suggestion-to-mutation.js";
import type { ProposalStats } from "../src/wolverine/wolverine-types.js";

const AGING_HOURS = 72;

/** Read-only spine stats for the proposal-hygiene detector. Null when the spine isn't reachable. */
async function gatherProposalStats(
  env: Record<string, string | undefined>,
  now: string,
): Promise<ProposalStats | undefined> {
  const rows = await resolveCockpitProposals(env, { limit: 500 }).catch(() => null);
  if (!rows) return undefined;
  const ageHours = (iso: string): number => (Date.parse(now) - Date.parse(iso)) / 3_600_000;
  const agingDraftCount = rows.filter(
    (p) => (p.status === "draft" || p.status === "pending_approval") && Number.isFinite(ageHours(p.createdAt)) && ageHours(p.createdAt) >= AGING_HOURS,
  ).length;
  const rejectedCount = rows.filter((p) => p.status === "rejected").length;
  return { agingDraftCount, rejectedCount, agingHours: AGING_HOURS };
}

export interface WolverineProposeResult {
  exitCode: number;
  lines: string[];
}

export async function runWolverinePropose(
  env: Record<string, string | undefined>,
  now: string,
  cwd: string,
): Promise<WolverineProposeResult> {
  const lines: string[] = ["Wolverine — propose fixes (read → detect → stage gated FixProposals)"];

  const proposalStats = await gatherProposalStats(env, now);
  if (!proposalStats) {
    lines.push("  proposal spine not reachable — proposal-hygiene skipped.");
  } else {
    lines.push(`  spine: ${proposalStats.agingDraftCount} aging draft(s) (>${AGING_HOURS}h), ${proposalStats.rejectedCount} rejected`);
  }

  const report = wolverineAudit({ now, env, proposalStats });
  const fixes = wolverineFixProposals(report.repairQueue, now);
  if (fixes.length === 0) {
    lines.push("  No fixable findings — nothing to propose. (Wolverine only proposes what maps to a gated adapter.)");
    return { exitCode: 0, lines };
  }

  lines.push(`\n  Staging ${fixes.length} FixProposal(s):`);
  let staged = 0;
  for (const p of fixes) {
    const saved = await saveProposal(cwd, p, now);
    if (!saved) {
      lines.push(`  ✗ ${p.id} — could not save to the local queue`);
      continue;
    }
    await markSimulatedApproved(cwd, { id: p.id }, now);
    const route = p.proposedPayload[ADAPTER_ROUTE_KEY] as { adapterId?: string } | undefined;
    lines.push(`  • ${p.id}`);
    lines.push(`       ${p.title} → adapter '${route?.adapterId}' (tier ${p.tier})`);
    staged += 1;
  }

  lines.push("");
  lines.push(`  ${staged} FixProposal(s) staged at simulated_approved — awaiting YOUR approval.`);
  lines.push(`  Approve + fire one (the gate still decides):`);
  lines.push(`    1) arm its adapter flag (e.g. ALLOW_EXEC_ARCHIVE_REJECTED=true)`);
  lines.push(`    2) npm run agent:approve-execution -- --id=<id>`);
  lines.push(`    3) npm run execute:approved`);
  lines.push(`  Then verify: npm run wolverine:audit  (and re-run this to confirm the finding cleared).`);
  return { exitCode: 0, lines };
}

const invokedDirectly =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runWolverinePropose(process.env, new Date().toISOString(), process.cwd())
    .then((res) => {
      for (const l of res.lines) console.log(l);
      process.exit(res.exitCode);
    })
    .catch((e) => {
      console.error(`wolverine-propose: unexpected error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
}
