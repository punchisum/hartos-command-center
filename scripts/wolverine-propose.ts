/**
 * scripts/wolverine-propose.ts — Wolverine: write audit findings into the COCKPIT as gated FixProposals.
 *
 * The host edge of the repair loop. It reads the proposal-spine hygiene stats (pg, precise —
 * excludes already-archived), runs the pure audit, maps fixable findings → tier-complete
 * FixProposals, and UPSERTS them into the Supabase spine (cockpit_proposals) at
 * `pending_approval` — so they appear in the cockpit alongside every other proposal, with the
 * existing Approve / Reject controls. It NEVER executes: the mutation only happens after Hart
 * approves and the gated executor runs. Automatic eyes, gated hands.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/wolverine-propose.js
 */

import { pathToFileURL } from "node:url";
import { wolverineAudit } from "../src/wolverine/wolverine-audit.js";
import { wolverineFixProposals } from "../src/wolverine/wolverine-fix-proposal.js";
import { toQueueItem } from "../src/cockpit/proposals/proposal-queue.js";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import { ADAPTER_ROUTE_KEY } from "../src/cockpit/suggestions/suggestion-to-mutation.js";
import { redact } from "../src/llm/redaction.js";
import type { ProposalStats } from "../src/wolverine/wolverine-types.js";

const AGING_HOURS = 72;

/** Precise hygiene counts (pg): aging drafts; rejected NOT already archived (excludes done fixes). */
const HYGIENE_SQL = `
  select
    count(*) filter (where status in ('draft','pending_approval')
                       and created_at < now() - make_interval(hours => $1::int))            as aging,
    count(*) filter (where status = 'rejected'
                       and coalesce(payload->>'archived','') <> 'true')                      as rejected
  from public.cockpit_proposals`;

export interface WolverineProposeResult {
  exitCode: number;
  lines: string[];
}

export async function runWolverinePropose(
  env: Record<string, string | undefined>,
  now: string,
): Promise<WolverineProposeResult> {
  const lines: string[] = ["Wolverine — propose fixes into the cockpit (read → detect → write to spine)"];

  const handle = createCockpitProposalDb(env);
  if (!handle) {
    lines.push("  proposal spine not configured (set HARTOS_SUPABASE_DB_URL) — cannot propose.");
    return { exitCode: 0, lines };
  }

  try {
    const res = await handle.query(HYGIENE_SQL, [AGING_HOURS]);
    const row = (res.rows[0] ?? {}) as { aging?: unknown; rejected?: unknown };
    const stats: ProposalStats = {
      agingDraftCount: Number(row.aging ?? 0),
      rejectedCount: Number(row.rejected ?? 0),
      agingHours: AGING_HOURS,
    };
    lines.push(`  spine: ${stats.agingDraftCount} aging draft(s) (>${AGING_HOURS}h), ${stats.rejectedCount} rejected (not archived)`);

    const report = wolverineAudit({ now, env, proposalStats: stats });
    const fixes = wolverineFixProposals(report.repairQueue, now);
    if (fixes.length === 0) {
      lines.push("  No fixable findings — nothing to propose. (Wolverine only proposes what maps to a gated adapter.)");
      return { exitCode: 0, lines };
    }

    lines.push(`\n  Writing ${fixes.length} FixProposal(s) to the cockpit spine (status pending_approval):`);
    let wrote = 0;
    for (const p of fixes) {
      // Convert to a queue item at pending_approval so the cockpit shows Approve/Reject; the full
      // proposal JSON (incl. mutationRoute) rides in the spine payload for the executor.
      const item = toQueueItem({ ...p, status: "pending_approval" }, now);
      await handle.store.upsert(item);
      const route = p.proposedPayload[ADAPTER_ROUTE_KEY] as { adapterId?: string } | undefined;
      lines.push(`  • ${p.id} → adapter '${route?.adapterId}' : ${p.title}`);
      wrote += 1;
    }

    lines.push("");
    lines.push(`  ${wrote} FixProposal(s) now in the cockpit, awaiting your Approve / Reject.`);
    lines.push(`  Reject → dropped (audited). Approve → simulated_approved; the gated spine-executor then mutates + audits.`);
    return { exitCode: 0, lines };
  } finally {
    await handle.close();
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runWolverinePropose(process.env, new Date().toISOString())
    .then((res) => {
      for (const l of res.lines) console.log(l);
      process.exit(res.exitCode);
    })
    .catch((e) => {
      console.error(`wolverine-propose: unexpected error: ${redact(e instanceof Error ? e.message : String(e))}`);
      process.exit(1);
    });
}
